// "This PC" – the machine the dashboard server runs on.
import si from 'systeminformation';
import { withHostHistory } from '../lib/history.js';

export const defaultRefresh = 3;

/** Runs slow probes in the background and returns the last known value. */
function background(ctx, key, maxAgeMs, fn) {
  const c = (ctx.cache[key] ??= { t: 0, v: null, running: null });
  if (!c.running && Date.now() - c.t > maxAgeMs) {
    c.running = fn()
      .then((v) => { c.v = v; })
      .catch(() => {})
      .finally(() => { c.t = Date.now(); c.running = null; });
  }
  return c;
}

const VIRTUAL_GPU = /basic display|basic render|virtual|parsec|remote|idd|meta/i;

function pickGpu(graphics) {
  const list = (graphics?.controllers || []).filter((g) => !VIRTUAL_GPU.test(`${g.vendor} ${g.model}`));
  if (!list.length) return null;
  const g = list.find((x) => x.utilizationGpu != null) || list.sort((a, b) => (b.vram || 0) - (a.vram || 0))[0];
  const mb = 1024 * 1024;
  return {
    name: g.model || g.name || g.vendor,
    load: g.utilizationGpu ?? null,
    temp: g.temperatureGpu ?? null,
    memUsed: g.memoryUsed != null ? g.memoryUsed * mb : null,
    memTotal: (g.memoryTotal ?? g.vram) != null ? (g.memoryTotal ?? g.vram) * mb : null,
    power: g.powerDraw ?? null,
  };
}

export async function collect(panel, ctx) {
  if (!ctx.cache.static) {
    const [cpu, os] = await Promise.all([si.cpu(), si.osInfo()]);
    ctx.cache.static = { cpu, os };
  }
  const { cpu, os } = ctx.cache.static;

  const disks = background(ctx, 'disks', 60_000, () => si.fsSize());
  const gpu = background(ctx, 'gpu', 8_000, () => si.graphics());
  const temp = background(ctx, 'temp', 10_000, () => si.cpuTemperature());

  const [load, mem, net, time] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.networkStats().catch(() => []),
    Promise.resolve(si.time()),
  ]);

  const rx = net.reduce((s, n) => s + Math.max(0, n.rx_sec || 0), 0);
  const tx = net.reduce((s, n) => s + Math.max(0, n.tx_sec || 0), 0);
  const seen = new Set();
  const diskList = (disks.v || [])
    .filter((d) => d.size > 0 && !seen.has(d.mount) && seen.add(d.mount))
    .slice(0, panel.maxDisks ?? 6)
    .map((d) => ({ mount: d.mount, used: d.used, total: d.size }));

  const t = temp.v?.main;
  return withHostHistory(ctx, {
    hostname: os.hostname,
    model: `${cpu.manufacturer} ${cpu.brand}`.trim(),
    os: `${os.distro} ${os.release}`.trim(),
    uptime: time.uptime,
    cpu: {
      load: load.currentLoad,
      cores: cpu.cores,
      perCore: load.cpus.map((c) => Math.round(c.load)),
      temp: t != null && t > 0 ? t : null,
      speed: cpu.speed,
    },
    mem: { used: mem.active, total: mem.total },
    swap: { used: mem.swapused, total: mem.swaptotal },
    gpu: pickGpu(gpu.v),
    disks: diskList,
    net: { rx, tx },
  });
}
