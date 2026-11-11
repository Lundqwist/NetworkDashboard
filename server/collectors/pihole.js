// Pi-hole v6 (REST API, default) and v5 (legacy api.php).
import { request, trimSlash } from '../lib/http.js';

export const defaultRefresh = 15;

/* ----------------------------- v6 ----------------------------- */

async function v6Login(panel, ctx) {
  const res = await request(`${trimSlash(panel.url)}/api/auth`, {
    method: 'POST',
    body: { password: panel.password ?? '' },
    insecure: panel.insecure ?? true,
  });
  const j = res.json();
  if (!j.session?.valid) throw new Error('Pi-hole login failed – check password (an app password is recommended)');
  ctx.cache.sid = j.session.sid ?? null;
}

async function v6(panel, ctx, path, opts = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (ctx.cache.sid === undefined) {
      ctx.cache.loginPromise ??= v6Login(panel, ctx).finally(() => { ctx.cache.loginPromise = null; });
      await ctx.cache.loginPromise;
    }
    const headers = ctx.cache.sid ? { 'X-FTL-SID': ctx.cache.sid } : {};
    const res = await request(`${trimSlash(panel.url)}${path}`, { ...opts, headers, insecure: panel.insecure ?? true });
    if (res.status === 401 && attempt === 0) {
      ctx.cache.sid = undefined;
      continue;
    }
    if (res.status >= 400) throw new Error(`Pi-hole ${path}: HTTP ${res.status}`);
    return res.body.length ? res.json() : {};
  }
  throw new Error('Pi-hole authentication failed');
}

function hourly(slots) {
  const buckets = new Map();
  for (const s of slots) {
    const hour = Math.floor(s.t / 3600) * 3600;
    const b = buckets.get(hour) || { t: hour, total: 0, blocked: 0 };
    b.total += s.total;
    b.blocked += s.blocked;
    buckets.set(hour, b);
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t).slice(-24);
}

async function collectV6(panel, ctx) {
  const [summary, blocking, history, top] = await Promise.all([
    v6(panel, ctx, '/api/stats/summary'),
    v6(panel, ctx, '/api/dns/blocking'),
    v6(panel, ctx, '/api/history').catch(() => ({ history: [] })),
    v6(panel, ctx, '/api/stats/top_domains?blocked=true&count=5').catch(() => ({ domains: [] })),
  ]);
  const q = summary.queries || {};
  return {
    version: 6,
    blocking: blocking.blocking === 'enabled',
    blockingTimer: blocking.timer ?? null,
    total: q.total,
    blocked: q.blocked,
    percent: q.percent_blocked,
    cached: q.cached,
    forwarded: q.forwarded,
    clients: summary.clients?.active,
    domains: summary.gravity?.domains_being_blocked,
    gravityUpdated: summary.gravity?.last_update ? summary.gravity.last_update * 1000 : null,
    history: hourly((history.history || []).map((h) => ({ t: h.timestamp, total: h.total, blocked: h.blocked }))),
    topBlocked: (top.domains || []).map((d) => ({ domain: d.domain, count: d.count })),
  };
}

/* ----------------------------- v5 ----------------------------- */

async function v5(panel, query) {
  const res = await request(`${trimSlash(panel.url)}/admin/api.php?${query}&auth=${encodeURIComponent(panel.token || panel.password || '')}`, {
    insecure: panel.insecure ?? true,
  });
  if (res.status !== 200) throw new Error(`Pi-hole answered HTTP ${res.status}`);
  return res.json();
}

async function collectV5(panel) {
  const [s, overTime, top] = await Promise.all([
    v5(panel, 'summaryRaw'),
    v5(panel, 'overTimeData10mins').catch(() => ({})),
    v5(panel, 'topItems=5').catch(() => ({})),
  ]);
  const ads = overTime.ads_over_time || {};
  const slots = Object.entries(overTime.domains_over_time || {}).map(([t, total]) => ({ t: Number(t), total, blocked: ads[t] || 0 }));
  return {
    version: 5,
    blocking: s.status === 'enabled',
    total: s.dns_queries_today,
    blocked: s.ads_blocked_today,
    percent: s.ads_percentage_today,
    cached: s.queries_cached,
    forwarded: s.queries_forwarded,
    clients: s.unique_clients,
    domains: s.domains_being_blocked,
    gravityUpdated: s.gravity_last_updated?.absolute ? s.gravity_last_updated.absolute * 1000 : null,
    history: hourly(slots),
    topBlocked: Object.entries(top.top_ads || {}).map(([domain, count]) => ({ domain, count })),
  };
}

export async function collect(panel, ctx) {
  return (panel.version ?? 6) >= 6 ? collectV6(panel, ctx) : collectV5(panel);
}

/** Enable or temporarily disable blocking. `timer` in seconds (disable only). */
export async function setBlocking(panel, ctx, enabled, timer = null) {
  if ((panel.version ?? 6) >= 6) {
    await v6(panel, ctx, '/api/dns/blocking', { method: 'POST', body: { blocking: !!enabled, timer: enabled ? null : timer } });
  } else {
    await v5(panel, enabled ? 'enable' : `disable=${timer || 0}`);
  }
}
