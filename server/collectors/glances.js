// Any host running Glances in web-server mode (`glances -w`), API v4 or v3.
// Handy for TrueNAS, Unraid, OpenMediaVault and other boxes that ship Glances.
import { request, trimSlash } from '../lib/http.js';
import { withHostHistory } from '../lib/history.js';

export const defaultRefresh = 5;

function parseUptime(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return null;
  const days = Number(v.match(/(\d+)\s+day/)?.[1] || 0);
  const hms = v.match(/(\d+):(\d+):(\d+)/);
  return days * 86400 + (hms ? Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]) : 0);
}

const REAL_FS = /^(ext\d|xfs|btrfs|zfs|vfat|exfat|ntfs|fuseblk|f2fs|nfs\d?|cifs|smb\d?|apfs|fuse\.shfs)$/i;

export async function collect(panel, ctx) {
  const base = trimSlash(panel.url);
  let all;
  for (const v of ctx.cache.apiVersion ? [ctx.cache.apiVersion] : [4, 3]) {
    const res = await request(`${base}/api/${v}/all`, { insecure: panel.insecure, timeout: panel.timeout ?? 6000 });
    if (res.status === 200) {
      ctx.cache.apiVersion = v;
      all = res.json();
      break;
    }
  }
  if (!all) throw new Error('Glances API not reachable (is `glances -w` running?)');

  const sensors = all.sensors || [];
  const tempSensor =
    sensors.find((s) => /cpu|package|tctl|soc|thermal/i.test(s.label) && /temp/i.test(s.type || 'temperature')) ||
    sensors.find((s) => /temp/i.test(s.type || ''));
  const fan = sensors.find((s) => /fan/i.test(s.type || ''));

  let rx = 0;
  let tx = 0;
  for (const n of all.network || []) {
    if (/^(lo|veth|docker|br-)/.test(n.interface_name)) continue;
    rx += n.bytes_recv_rate_per_sec ?? (n.time_since_update ? n.rx / n.time_since_update : 0) ?? 0;
    tx += n.bytes_sent_rate_per_sec ?? (n.time_since_update ? n.tx / n.time_since_update : 0) ?? 0;
  }

  const sys = all.system || {};
  const containers = (all.containers || all.docker?.containers || []).map((c) => ({
    name: c.name,
    state: String(c.status || c.Status || '').toLowerCase().startsWith('running') ? 'running' : String(c.status || 'unknown').toLowerCase(),
    status: c.status,
  }));

  return withHostHistory(ctx, {
    hostname: sys.hostname,
    model: all.quicklook?.cpu_name || sys.platform,
    os: sys.linux_distro || `${sys.os_name || ''} ${sys.os_version || ''}`.trim(),
    uptime: parseUptime(all.uptime),
    cpu: {
      load: all.cpu?.total ?? all.quicklook?.cpu,
      cores: all.core?.log ?? all.load?.cpucore,
      perCore: (all.percpu || []).map((c) => Math.round(c.total)),
      temp: tempSensor?.value ?? null,
    },
    mem: { used: all.mem?.used, total: all.mem?.total },
    swap: { used: all.memswap?.used, total: all.memswap?.total },
    load: all.load ? [all.load.min1, all.load.min5, all.load.min15] : null,
    fan: fan?.value ?? null,
    disks: (all.fs || [])
      .filter((f) => !f.fs_type || REAL_FS.test(f.fs_type))
      .slice(0, panel.maxDisks ?? 6)
      .map((f) => ({ mount: f.mnt_point, used: f.used, total: f.size })),
    net: { rx, tx },
    containers: containers.length ? containers : undefined,
  });
}
