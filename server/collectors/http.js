// Website / server uptime: status code, latency, TLS certificate expiry,
// optional keyword check, plus optional host metrics for the server itself.
import { request } from '../lib/http.js';
import { push } from '../lib/history.js';

export const defaultRefresh = 60;

async function check(site) {
  try {
    const res = await request(site.url, {
      method: site.method || 'GET',
      timeout: site.timeout ?? 10000,
      insecure: site.insecure,
      headers: site.headers,
      auth: site.username ? { username: site.username, password: site.password } : undefined,
    });
    let ok = site.expectStatus ? res.status === site.expectStatus : res.status < 400;
    let error = ok ? null : `HTTP ${res.status}`;
    if (ok && site.keyword && !res.text().includes(site.keyword)) {
      ok = false;
      error = `Keyword "${site.keyword}" missing`;
    }
    const certDays = res.cert ? Math.floor((Date.parse(res.cert.validTo) - Date.now()) / 86_400_000) : null;
    return { ok, status: res.status, ms: Math.round(res.ms), certDays, error };
  } catch (e) {
    return { ok: false, status: null, ms: null, certDays: null, error: e.message };
  }
}

export async function collect(panel, ctx) {
  const sites = await Promise.all(
    (panel.sites || []).map(async (site, i) => {
      const r = await check(site);
      const key = `site${i}`;
      const ms = push(ctx, key, r.ok ? r.ms : null);
      const okHist = push(ctx, `${key}ok`, r.ok ? 1 : 0, 1440);
      return {
        name: site.name || new URL(site.url).host,
        url: site.url,
        ...r,
        history: ms,
        uptime: (okHist.reduce((a, b) => a + b, 0) / okHist.length) * 100,
      };
    }),
  );

  let host = null;
  let hostError = null;
  if (panel.host?.type) {
    const mod = ctx.collectors[panel.host.type];
    ctx.cache.hostCtx ??= { history: {}, cache: {}, collectors: ctx.collectors };
    try {
      host = await mod.collect(panel.host, ctx.cache.hostCtx);
    } catch (e) {
      hostError = e.message;
    }
  }
  return { sites, host, hostError };
}
