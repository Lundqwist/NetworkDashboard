#!/usr/bin/env python3
"""
Network Dashboard agent – a tiny, dependency-free metrics endpoint for Linux
hosts (Raspberry Pi, home server, Linux-based NAS).

    python3 dashboard_agent.py --token SECRET [--port 61209]
        [--services pihole-FTL,nginx] [--docker] [--apt]

GET /stats  -> JSON (requires "Authorization: Bearer SECRET" when a token is set)
GET /health -> "ok"
"""
import argparse
import glob
import hmac
import json
import os
import shutil
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

REAL_FS = {
    "ext2", "ext3", "ext4", "xfs", "btrfs", "zfs", "vfat", "exfat", "f2fs",
    "ntfs", "ntfs3", "fuseblk", "nfs", "nfs4", "cifs", "smb3",
}
SKIP_MOUNT_PREFIXES = ("/snap", "/var/lib/docker", "/run", "/boot/efi", "/proc", "/sys", "/dev")
THROTTLE_BITS = {
    0: "Under-voltage", 1: "Frequency capped", 2: "Throttled", 3: "Soft temp limit",
}


def read(path, default=None):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return default


def run(cmd, timeout=5):
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return out.stdout.strip() if out.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


class Sampler(threading.Thread):
    """Samples CPU and network counters every `interval` seconds so that
    /stats can answer instantly with rates."""

    def __init__(self, interval=2.0):
        super().__init__(daemon=True)
        self.interval = interval
        self.cpu = None
        self.per_core = []
        self.rx = None
        self.tx = None
        self._prev_cpu = None
        self._prev_net = None

    @staticmethod
    def _cpu_times():
        rows = {}
        for line in (read("/proc/stat", "") or "").splitlines():
            if line.startswith("cpu"):
                parts = line.split()
                vals = list(map(int, parts[1:]))
                idle = vals[3] + (vals[4] if len(vals) > 4 else 0)
                rows[parts[0]] = (sum(vals), idle)
        return rows

    @staticmethod
    def _net_bytes():
        rx = tx = 0
        for line in (read("/proc/net/dev", "") or "").splitlines()[2:]:
            name, data = line.split(":", 1)
            name = name.strip()
            if name == "lo" or name.startswith(("veth", "docker", "br-", "virbr")):
                continue
            f = data.split()
            rx += int(f[0])
            tx += int(f[8])
        return rx, tx, time.monotonic()

    def run(self):
        while True:
            cpu = self._cpu_times()
            net = self._net_bytes()
            if self._prev_cpu:
                def pct(key):
                    t0, i0 = self._prev_cpu.get(key, (0, 0))
                    t1, i1 = cpu.get(key, (0, 0))
                    dt = t1 - t0
                    return round(100.0 * (1 - (i1 - i0) / dt), 1) if dt > 0 else 0.0

                self.cpu = pct("cpu")
                self.per_core = [round(pct(k)) for k in sorted((k for k in cpu if k != "cpu"), key=lambda k: int(k[3:]))]
            if self._prev_net:
                dt = net[2] - self._prev_net[2]
                if dt > 0:
                    self.rx = max(0, (net[0] - self._prev_net[0]) / dt)
                    self.tx = max(0, (net[1] - self._prev_net[1]) / dt)
            self._prev_cpu, self._prev_net = cpu, net
            time.sleep(self.interval)


class SlowInfo(threading.Thread):
    """Things that are expensive to query: apt updates (hourly), docker (30 s)."""

    def __init__(self, docker=False, apt=False):
        super().__init__(daemon=True)
        self.docker = docker
        self.apt = apt
        self.containers = None
        self.updates = None
        self._last_apt = 0

    def run(self):
        while True:
            if self.docker and shutil.which("docker"):
                out = run(["docker", "ps", "-a", "--format", "{{.Names}}\t{{.State}}\t{{.Status}}"], timeout=10)
                if out is not None:
                    self.containers = [
                        dict(zip(("name", "state", "status"), line.split("\t")))
                        for line in out.splitlines() if line.strip()
                    ]
            if self.apt and time.time() - self._last_apt > 3600 and shutil.which("apt-get"):
                out = run(["apt-get", "-s", "-o", "Debug::NoLocking=true", "upgrade"], timeout=120)
                if out is not None:
                    self.updates = sum(1 for line in out.splitlines() if line.startswith("Inst "))
                self._last_apt = time.time()
            time.sleep(30)


def cpu_temp():
    zones = sorted(glob.glob("/sys/class/thermal/thermal_zone*"))
    best = None
    for z in zones:
        kind = (read(f"{z}/type", "") or "").strip()
        val = read(f"{z}/temp")
        if val is None:
            continue
        t = int(val) / 1000.0
        if any(k in kind for k in ("cpu", "soc", "x86_pkg", "coretemp")):
            return round(t, 1)
        best = best if best is not None else round(t, 1)
    if best is None:
        for p in glob.glob("/sys/class/hwmon/hwmon*/temp1_input"):
            v = read(p)
            if v:
                return round(int(v) / 1000.0, 1)
    return best


def fan_rpm():
    for p in glob.glob("/sys/devices/platform/cooling_fan/hwmon/hwmon*/fan1_input") + glob.glob("/sys/class/hwmon/hwmon*/fan1_input"):
        v = read(p)
        if v and v.strip().isdigit():
            return int(v)
    return None


def throttled():
    if not shutil.which("vcgencmd"):
        return None
    out = run(["vcgencmd", "get_throttled"])
    if not out or "=" not in out:
        return None
    bits = int(out.split("=")[1], 16)
    return {
        "now": [n for b, n in THROTTLE_BITS.items() if bits & (1 << b)],
        "past": [n for b, n in THROTTLE_BITS.items() if bits & (1 << (b + 16))],
    }


def meminfo():
    m = {}
    for line in (read("/proc/meminfo", "") or "").splitlines():
        k, _, v = line.partition(":")
        m[k] = int(v.split()[0]) * 1024 if v.split() else 0
    total = m.get("MemTotal", 0)
    avail = m.get("MemAvailable", m.get("MemFree", 0))
    return {"used": total - avail, "total": total}, {"used": m.get("SwapTotal", 0) - m.get("SwapFree", 0), "total": m.get("SwapTotal", 0)}


def disks(extra):
    out, seen = [], set()
    for line in (read("/proc/mounts", "") or "").splitlines():
        dev, mnt, fs = line.split()[:3]
        mnt = mnt.replace("\\040", " ")
        if fs not in REAL_FS or mnt.startswith(SKIP_MOUNT_PREFIXES) and mnt not in extra:
            continue
        if dev in seen:
            continue
        try:
            st = os.statvfs(mnt)
        except OSError:
            continue
        total = st.f_blocks * st.f_frsize
        if total < 256 * 1024 * 1024:
            continue
        seen.add(dev)
        out.append({"mount": mnt, "used": total - st.f_bfree * st.f_frsize, "total": total})
    return out


def os_name():
    for line in (read("/etc/os-release", "") or "").splitlines():
        if line.startswith("PRETTY_NAME="):
            return line.split("=", 1)[1].strip('"')
    return os.uname().sysname


def model():
    m = read("/proc/device-tree/model") or read("/sys/firmware/devicetree/base/model")
    if m:
        return m.replace("\x00", "").strip()
    for line in (read("/proc/cpuinfo", "") or "").splitlines():
        if line.startswith("model name"):
            return line.split(":", 1)[1].strip()
    return os.uname().machine


def cpu_freq():
    v = read("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq")
    return round(int(v) / 1000) if v and v.strip().isdigit() else None


def service_states(names):
    res = []
    for n in names:
        state = run(["systemctl", "is-active", n]) if shutil.which("systemctl") else None
        res.append({"name": n, "active": state == "active"})
    return res


def build_stats(args, sampler, slow):
    mem, swap = meminfo()
    data = {
        "hostname": socket.gethostname(),
        "model": MODEL,
        "os": OS_NAME,
        "uptime": float((read("/proc/uptime", "0") or "0").split()[0]),
        "cpu": {
            "load": sampler.cpu,
            "cores": os.cpu_count(),
            "perCore": sampler.per_core,
            "temp": cpu_temp(),
            "freq": cpu_freq(),
        },
        "mem": mem,
        "swap": swap,
        "load": [round(x, 2) for x in os.getloadavg()],
        "disks": disks(set(args.mounts)),
        "net": {"rx": sampler.rx, "tx": sampler.tx},
        "fan": fan_rpm(),
        "throttled": throttled(),
    }
    if args.services:
        data["services"] = service_states(args.services)
    if slow.containers is not None:
        data["containers"] = slow.containers
    if slow.updates is not None:
        data["updates"] = slow.updates
    return data


def make_handler(args, sampler, slow):
    class Handler(BaseHTTPRequestHandler):
        server_version = "DashboardAgent/1.0"

        def _send(self, code, body, ctype="application/json"):
            payload = body.encode() if isinstance(body, str) else body
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):
            if self.path == "/health":
                return self._send(200, "ok", "text/plain")
            if self.path.split("?")[0] != "/stats":
                return self._send(404, '{"error":"not found"}')
            if args.token:
                given = self.headers.get("Authorization", "").removeprefix("Bearer ").strip()
                if not hmac.compare_digest(given, args.token):
                    return self._send(401, '{"error":"unauthorized"}')
            self._send(200, json.dumps(build_stats(args, sampler, slow)))

        def log_message(self, *_):
            pass

    return Handler


MODEL = model()
OS_NAME = os_name()


def main():
    p = argparse.ArgumentParser(description="Network Dashboard metrics agent")
    p.add_argument("--host", default=os.environ.get("DASHBOARD_AGENT_HOST", "0.0.0.0"))
    p.add_argument("--port", type=int, default=int(os.environ.get("DASHBOARD_AGENT_PORT", "61209")))
    p.add_argument("--token", default=os.environ.get("DASHBOARD_AGENT_TOKEN", ""))
    p.add_argument("--services", default=os.environ.get("DASHBOARD_AGENT_SERVICES", ""),
                   help="comma-separated systemd units to report, e.g. pihole-FTL,nginx")
    p.add_argument("--mounts", default="", help="extra comma-separated mount points to always include")
    p.add_argument("--docker", action="store_true", help="report docker containers (user needs docker access)")
    p.add_argument("--apt", action="store_true", help="report number of pending apt upgrades (checked hourly)")
    args = p.parse_args()
    args.services = [s.strip() for s in args.services.split(",") if s.strip()]
    args.mounts = [s.strip() for s in args.mounts.split(",") if s.strip()]
    if not args.token:
        print("WARNING: no --token set; /stats is readable by anyone on the network")

    sampler = Sampler()
    sampler.start()
    slow = SlowInfo(docker=args.docker, apt=args.apt)
    slow.start()

    server = ThreadingHTTPServer((args.host, args.port), make_handler(args, sampler, slow))
    print(f"Dashboard agent listening on http://{args.host}:{args.port}/stats")
    server.serve_forever()


if __name__ == "__main__":
    main()
