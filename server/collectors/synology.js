// Synology DSM via its Web API. Create a dedicated DSM user without 2FA
// (read-only/administrators group is needed for storage information).
import { request, trimSlash } from '../lib/http.js';
import { withHostHistory } from '../lib/history.js';

export const defaultRefresh = 15;

const SESSION_ERRORS = new Set([105, 106, 107, 119]);

async function login(panel, ctx) {
  const q = new URLSearchParams({
    api: 'SYNO.API.Auth',
    version: '3',
    method: 'login',
    account: panel.username,
    passwd: panel.password,
    session: 'NetworkDashboard',
    format: 'sid',
  });
  const res = await request(`${trimSlash(panel.url)}/webapi/auth.cgi?${q}`, { insecure: panel.insecure, timeout: 10000 });
  const j = res.json();
  if (!j.success) throw new Error(`DSM login failed (code ${j.error?.code}) – check user/password, 2FA must be off`);
  ctx.cache.sid = j.data.sid;
}

async function api(panel, ctx, params, retry = true) {
  if (!ctx.cache.sid) {
    ctx.cache.loginPromise ??= login(panel, ctx).finally(() => { ctx.cache.loginPromise = null; });
    await ctx.cache.loginPromise;
  }
  const q = new URLSearchParams({ ...params, _sid: ctx.cache.sid });
  const res = await request(`${trimSlash(panel.url)}/webapi/entry.cgi?${q}`, { insecure: panel.insecure, timeout: 10000 });
  const j = res.json();
  if (!j.success) {
    if (retry && SESSION_ERRORS.has(j.error?.code)) {
      ctx.cache.sid = null;
      return api(panel, ctx, params, false);
    }
    throw new Error(`${params.api} failed (code ${j.error?.code})`);
  }
  return j.data;
}

function parseUptime(v) {
  if (typeof v === 'number') return v;
  const parts = String(v || '').split(':').map(Number);
  if (parts.some(Number.isNaN) || !parts.length) return null;
  return parts.reverse().reduce((s, n, i) => s + n * [1, 60, 3600, 86400][i], 0);
}

export async function collect(panel, ctx) {
  const [util, info, storage] = await Promise.all([
    api(panel, ctx, { api: 'SYNO.Core.System.Utilization', version: '1', method: 'get' }),
    api(panel, ctx, { api: 'SYNO.Core.System', version: '1', method: 'info' }).catch(() => ({})),
    api(panel, ctx, { api: 'SYNO.Storage.CGI.Storage', version: '1', method: 'load_info' }).catch(() => ({})),
  ]);

  const cpu = util.cpu || {};
  const memory = util.memory || {};
  const totalNet = (util.network || []).find((n) => n.device === 'total') || {};
  const kb = 1024;

  return withHostHistory(ctx, {
    hostname: info.server_name || panel.title,
    model: info.model ? `Synology ${info.model}` : 'Synology',
    os: info.firmware_ver || 'DSM',
    uptime: parseUptime(info.up_time),
    cpu: {
      load: (cpu.user_load || 0) + (cpu.system_load || 0) + (cpu.other_load || 0),
      temp: info.sys_temp ?? info.temperature ?? null,
    },
    mem: {
      used:
        memory.total_real == null
          ? null
          : memory.real_usage != null
            ? (memory.total_real * kb * memory.real_usage) / 100
            : (memory.total_real - (memory.avail_real || 0)) * kb,
      total: memory.total_real != null ? memory.total_real * kb : null,
    },
    swap: memory.total_swap ? { used: (memory.total_swap - memory.avail_swap) * kb, total: memory.total_swap * kb } : undefined,
    disks: (storage.volumes || []).map((v) => ({
      mount: (v.display_name || v.id || '').replace('volume_', 'Volume '),
      used: Number(v.size?.used),
      total: Number(v.size?.total),
      status: v.status,
    })),
    drives: (storage.disks || []).map((d) => ({
      name: d.name || d.id,
      model: d.model,
      temp: d.temp,
      status: d.status,
      smart: d.smart_status,
    })),
    net: { rx: totalNet.rx ?? null, tx: totalNet.tx ?? null },
  });
}
