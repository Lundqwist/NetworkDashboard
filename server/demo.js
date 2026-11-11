// Fake but plausible data so the dashboard can be previewed without any devices
// (`npm run demo`). Each panel type gets its own generator.
import { push, withHostHistory } from './lib/history.js';

const GB = 1024 ** 3;
const rand = (a, b) => a + Math.random() * (b - a);

function walk(ctx, key, min, max, step) {
  const prev = ctx.cache[key] ?? rand(min, max);
  const next = Math.min(max, Math.max(min, prev + rand(-step, step)));
  ctx.cache[key] = next;
  return next;
}

function seedHistory(ctx, fn) {
  if (ctx.cache.seeded) return;
  ctx.cache.seeded = true;
  for (let i = 0; i < 59; i++) fn();
}

const hosts = {
  local: (ctx) => ({
    hostname: 'DESKTOP-MAIN',
    model: 'AMD Ryzen 7 7800X3D',
    os: 'Microsoft Windows 11 Pro 10.0.26300',
    uptime: 3 * 86400 + 4 * 3600 + (ctx.cache.t ?? 0),
    cpu: { load: walk(ctx, 'cpu', 4, 65, 8), cores: 16, perCore: Array.from({ length: 16 }, () => Math.round(rand(0, 70))), temp: walk(ctx, 'temp', 42, 71, 2), speed: 4.2 },
    mem: { used: walk(ctx, 'mem', 14, 22, 0.4) * GB, total: 32 * GB },
    swap: { used: 1.2 * GB, total: 8 * GB },
    gpu: { name: 'NVIDIA GeForce RTX 4070', load: walk(ctx, 'gpu', 1, 45, 6), temp: walk(ctx, 'gtemp', 38, 62, 2), memUsed: walk(ctx, 'gmem', 2, 5, 0.2) * GB, memTotal: 12 * GB, power: walk(ctx, 'gpw', 20, 140, 12) },
    disks: [
      { mount: 'C:', used: 612 * GB, total: 931 * GB },
      { mount: 'D:', used: 1.42 * 1024 * GB, total: 1.82 * 1024 * GB },
      { mount: 'E:', used: 388 * GB, total: 931 * GB },
    ],
    net: { rx: walk(ctx, 'rx', 0.02e6, 6e6, 1.2e6), tx: walk(ctx, 'tx', 0.01e6, 1.5e6, 0.3e6) },
  }),
  agent: (ctx) => ({
    hostname: 'raspberrypi5',
    model: 'Raspberry Pi 5 Model B Rev 1.0',
    os: 'Debian GNU/Linux 12 (bookworm)',
    uptime: 21 * 86400 + 7 * 3600,
    cpu: { load: walk(ctx, 'cpu', 2, 38, 5), cores: 4, perCore: [12, 8, 22, 5], temp: walk(ctx, 'temp', 46, 61, 1.5), freq: 2400 },
    mem: { used: walk(ctx, 'mem', 1.6, 2.6, 0.1) * GB, total: 8 * GB },
    swap: { used: 0, total: 0.5 * GB },
    load: [0.42, 0.38, 0.31],
    fan: Math.round(walk(ctx, 'fan', 0, 3200, 300)),
    throttled: { now: [], past: [] },
    disks: [
      { mount: '/', used: 18.4 * GB, total: 116 * GB },
      { mount: '/mnt/ssd', used: 212 * GB, total: 465 * GB },
    ],
    net: { rx: walk(ctx, 'rx', 5e3, 900e3, 150e3), tx: walk(ctx, 'tx', 5e3, 400e3, 80e3) },
    services: [
      { name: 'pihole-FTL', active: true },
      { name: 'docker', active: true },
      { name: 'tailscaled', active: true },
    ],
    containers: [
      { name: 'homeassistant', state: 'running', status: 'Up 6 days' },
      { name: 'go2rtc', state: 'running', status: 'Up 6 days' },
      { name: 'uptime-kuma', state: 'exited', status: 'Exited (1) 2 hours ago' },
    ],
    updates: 7,
  }),
  synology: (ctx) => ({
    hostname: 'nas',
    model: 'Synology DS923+',
    os: 'DSM 7.2.2-72806',
    uptime: 46 * 86400,
    cpu: { load: walk(ctx, 'cpu', 3, 30, 4), temp: walk(ctx, 'temp', 40, 49, 1) },
    mem: { used: walk(ctx, 'mem', 2.8, 3.6, 0.1) * GB, total: 8 * GB },
    disks: [
      { mount: 'Volume 1', used: 9.1 * 1024 * GB, total: 14.5 * 1024 * GB, status: 'normal' },
      { mount: 'Volume 2', used: 0.6 * 1024 * GB, total: 1.8 * 1024 * GB, status: 'normal' },
    ],
    drives: [
      { name: 'Drive 1', temp: 36, status: 'normal' },
      { name: 'Drive 2', temp: 37, status: 'normal' },
      { name: 'Drive 3', temp: 38, status: 'normal' },
      { name: 'Drive 4', temp: 36, status: 'normal' },
    ],
    net: { rx: walk(ctx, 'rx', 10e3, 40e6, 8e6), tx: walk(ctx, 'tx', 10e3, 12e6, 3e6) },
  }),
};
hosts.glances = hosts.agent;

function hostDemo(type, ctx) {
  const gen = () => withHostHistory(ctx, hosts[type](ctx));
  seedHistory(ctx, gen);
  ctx.cache.t = (ctx.cache.t ?? 0) + 3;
  return gen();
}

function pihole(ctx) {
  const now = Math.floor(Date.now() / 3_600_000) * 3600;
  ctx.cache.hist ??= Array.from({ length: 24 }, (_, i) => {
    const hour = new Date((now - (23 - i) * 3600) * 1000).getHours();
    const activity = hour >= 7 && hour <= 23 ? 1 : 0.25;
    const total = Math.round(rand(500, 1400) * activity);
    return { t: now - (23 - i) * 3600, total, blocked: Math.round(total * rand(0.1, 0.24)) };
  });
  const total = ctx.cache.hist.reduce((s, h) => s + h.total, 0);
  const blocked = ctx.cache.hist.reduce((s, h) => s + h.blocked, 0);
  return {
    version: 6,
    blocking: ctx.cache.blocking ?? true,
    total,
    blocked,
    percent: (blocked / total) * 100,
    clients: 14,
    domains: 182_544,
    gravityUpdated: Date.now() - 2 * 86_400_000,
    history: ctx.cache.hist,
    topBlocked: [
      { domain: 'app-measurement.com', count: 1204 },
      { domain: 'browser.events.data.msn.com', count: 862 },
      { domain: 'telemetry.tv.example', count: 517 },
      { domain: 'ads.example-network.net', count: 233 },
      { domain: 'stats.example.org', count: 141 },
    ],
  };
}

function http(panel, ctx) {
  const sites = (panel.sites || []).map((s, i) => {
    const ok = i !== 2 || Math.random() > 0.3;
    const ms = ok ? Math.round(walk(ctx, `ms${i}`, 60, 420, 40)) : null;
    const history = push(ctx, `site${i}`, ms);
    if (history.length < 30) for (let k = 0; k < 30; k++) push(ctx, `site${i}`, Math.round(rand(80, 300)));
    return { name: s.name, url: s.url, ok, status: ok ? 200 : 503, ms, certDays: [64, 12, 88][i % 3], error: ok ? null : 'HTTP 503', history: ctx.history[`site${i}`], uptime: ok ? 100 : 98.6 };
  });
  return { sites, host: panel.host ? hostDemo('agent', (ctx.cache.hostCtx ??= { history: {}, cache: {} })) : null };
}

function network(panel, ctx) {
  return {
    devices: (panel.devices || []).map((d, i) => {
      const up = i !== 5;
      const ms = up ? walk(ctx, `n${i}`, i === 0 ? 0.5 : 1, i === 0 ? 2 : i === 1 ? 18 : 9, 1) : null;
      seedHistory({ cache: ctx.cache[`seed${i}`] ??= {} }, () => push(ctx, `d${i}`, up ? walk(ctx, `n${i}`, 0.5, 18, 1) : null));
      return { name: d.name, host: d.host, up, ms, history: push(ctx, `d${i}`, ms) };
    }),
  };
}

function printer(panel) {
  if (panel.protocol === 'octoprint' || panel.protocol === 'moonraker') {
    return { kind: '3d', name: panel.title, state: 'printing', stateText: 'Printing', file: 'benchy_0.2mm_PLA.gcode', progress: 64, elapsed: 2280, timeLeft: 1290, hotend: { actual: 214.6, target: 215 }, bed: { actual: 59.8, target: 60 } };
  }
  return {
    kind: 'ipp',
    name: 'Office Printer',
    model: 'Brother MFC-L3770CDW',
    state: 'idle',
    message: 'Ready',
    jobs: 0,
    reasons: [{ text: 'Toner low', severity: 'warning' }],
    markers: [
      { name: 'Black Toner', level: 72, color: '#000000', low: 10 },
      { name: 'Cyan Toner', level: 45, color: '#00FFFF', low: 10 },
      { name: 'Magenta Toner', level: 8, color: '#FF00FF', low: 10 },
      { name: 'Yellow Toner', level: 61, color: '#FFFF00', low: 10 },
    ],
  };
}

function weather(panel) {
  const now = Date.now();
  const h0 = Math.floor(now / 3_600_000) * 3_600_000;
  const day = new Date();
  return {
    location: panel.location || 'Demo City',
    units: { temp: '°C', wind: 'm/s' },
    current: { temp: 6.4, feels: 3.1, humidity: 82, wind: 4.6, code: 3, isDay: true },
    sunrise: new Date(day.setHours(7, 32, 0, 0)).getTime(),
    sunset: new Date(day.setHours(15, 48, 0, 0)).getTime(),
    hourly: Array.from({ length: 24 }, (_, i) => {
      const hour = new Date(h0 + i * 3_600_000).getHours();
      return { t: h0 + i * 3_600_000, temp: Math.round((4 + 3 * Math.sin(((hour - 8) / 24) * 2 * Math.PI)) * 10) / 10, pop: [5, 10, 20, 45, 70, 60, 30, 10][i % 8], code: [3, 3, 61, 61, 3, 2, 1, 0][i % 8] };
    }),
    daily: Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now + i * 86_400_000);
      return { date: d.toISOString().slice(0, 10), code: [3, 61, 80, 2, 0, 71][i], max: [7, 6, 5, 8, 9, 2][i], min: [2, 3, 1, 0, 1, -3][i], pop: [40, 85, 70, 10, 5, 60][i] };
    }),
  };
}

export const defaultRefresh = 3;

export async function collect(panel, ctx) {
  switch (panel.type) {
    case 'local':
    case 'agent':
    case 'glances':
    case 'synology':
      return hostDemo(panel.type, ctx);
    case 'pihole':
      return pihole(ctx);
    case 'http':
      return http(panel, ctx);
    case 'network':
      return network(panel, ctx);
    case 'printer':
      return printer(panel);
    case 'weather':
      return weather(panel);
    case 'camera':
      return { mode: 'snapshot', online: true };
    default:
      return null;
  }
}

export function demoSnapshot(title = 'Camera') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2f36"/><stop offset="1" stop-color="#14161a"/></linearGradient></defs>
  <rect width="1280" height="720" fill="url(#g)"/>
  <polygon points="380,720 560,250 720,250 900,720" fill="#24272d"/>
  <rect x="560" y="120" width="160" height="300" fill="#1d2026" stroke="#3a3f47" stroke-width="4"/>
  <circle cx="700" cy="280" r="7" fill="#6d7480"/>
  <rect x="140" y="160" width="200" height="140" fill="#20242a" stroke="#3a3f47" stroke-width="3"/>
  <rect x="960" y="180" width="60" height="300" fill="#1f2228"/>
  <text x="40" y="60" font-family="Segoe UI, sans-serif" font-size="34" fill="#c3c2b7">${title} · DEMO</text>
</svg>`;
}
