// Reachability of devices on the LAN (and the internet) via ICMP ping or TCP connect.
import { execFile } from 'node:child_process';
import net from 'node:net';
import { push } from '../lib/history.js';

export const defaultRefresh = 10;

export function ping(host, timeoutMs = 1500) {
  const sec = String(Math.max(1, Math.ceil(timeoutMs / 1000)));
  const args =
    process.platform === 'win32'
      ? ['-n', '1', '-w', String(timeoutMs), host]
      : process.platform === 'darwin'
        ? ['-c', '1', '-t', sec, host]
        : ['-c', '1', '-W', sec, host];
  return new Promise((resolve) => {
    execFile('ping', args, { timeout: timeoutMs + 3000, windowsHide: true }, (_err, stdout) => {
      const out = String(stdout || '');
      // Works across locales: "time=12ms", "tid<1ms", "time=0.42 ms" + a TTL field.
      const m = out.match(/[=<]\s?(\d+(?:[.,]\d+)?)\s?ms/i);
      resolve(m && /ttl[=:]/i.test(out) ? { up: true, ms: parseFloat(m[1].replace(',', '.')) } : { up: false, ms: null });
    });
  });
}

export function tcpProbe(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const start = performance.now();
    const sock = net.connect({ host, port, timeout: timeoutMs });
    const done = (up) => {
      sock.destroy();
      resolve({ up, ms: up ? Math.round((performance.now() - start) * 10) / 10 : null });
    };
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

export async function collect(panel, ctx) {
  const devices = await Promise.all(
    (panel.devices || []).map(async (d, i) => {
      const r = d.port ? await tcpProbe(d.host, d.port, d.timeout) : await ping(d.host, d.timeout);
      const history = push(ctx, `d${i}`, r.ms);
      return { name: d.name || d.host, host: d.host, port: d.port, ...r, history };
    }),
  );
  return { devices };
}
