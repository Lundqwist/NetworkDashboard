import { renderers } from './panels.js';
import { esc, icon, ago, chip, weatherInfo, isNum } from './ui.js';

const api = {
  async json(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    return res.json();
  },
  post: (url, body) => api.json('POST', url, body || {}),
  patch: (url, body) => api.json('PATCH', url, body),
  del: (url) => api.json('DELETE', url),
  poll: () => poll(),
};

const cfg = await (await fetch('/api/config')).json();
document.title = cfg.title;
const locale = cfg.locale || undefined;

/* ------------------------------ layout ------------------------------ */

const grid = document.getElementById('grid');
const areas = (cfg.layout?.areas || []).map((r) => r.trim().split(/\s+/));
const cols = cfg.layout?.columns || areas[0]?.length || 4;
const rows = cfg.layout?.rows || areas.length || 3;
grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
grid.style.gridTemplateAreas = areas.map((r) => `"${r.join(' ')}"`).join(' ');
const placed = new Set(areas.flat());
const rowSpan = (id) => areas.filter((r) => r.includes(id)).length;

const views = new Map();
for (const p of cfg.panels) {
  if (!placed.has(p.id)) continue;
  const el = document.createElement('section');
  el.className = `panel type-${p.type}`;
  el.style.gridArea = p.id;
  el.innerHTML = `
    <div class="panel-head">
      ${icon(p.icon || p.type)}
      <h2>${esc(p.title || p.id)}</h2>
      <span class="panel-status"></span>
    </div>
    <div class="panel-body"><div class="empty">Connecting…</div></div>
    <div class="panel-error hidden"></div>`;
  grid.appendChild(el);
  const view = {
    cfg: { ...p, _rows: rowSpan(p.id) },
    el,
    body: el.querySelector('.panel-body'),
    status: el.querySelector('.panel-status'),
    error: el.querySelector('.panel-error'),
    renderer: renderers[p.type],
    last: null,
    mounted: false,
  };
  if (view.renderer?.mount) {
    view.renderer.mount(view.body, view.cfg, api);
    view.mounted = true;
  }
  views.set(p.id, view);
}
if (cfg.demo) document.getElementById('demo-badge').classList.remove('hidden');

/* ------------------------------ polling ------------------------------ */

let lastState = null;
let inflight = false;

async function poll() {
  if (inflight) return;
  inflight = true;
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    lastState = await res.json();
    document.body.classList.remove('offline');
    render(lastState);
  } catch {
    document.body.classList.add('offline');
  } finally {
    inflight = false;
  }
}

function render(st) {
  let ok = 0;
  let total = 0;
  for (const [id, v] of views) {
    const s = st.panels[id];
    if (!s) continue;
    if (s.type !== 'tasks') {
      total++;
      if (s.status === 'ok') ok++;
    }
    v.el.classList.toggle('is-error', s.status === 'error');
    v.el.classList.toggle('is-stale', s.status === 'error' && !!s.data);

    if (s.status === 'error') {
      v.status.innerHTML = chip('crit', 'Error', s.error);
      v.error.textContent = s.error;
      v.error.classList.remove('hidden');
    } else {
      v.status.innerHTML = s.status === 'pending' ? chip('idle', 'Waiting') : `<span class="muted small" data-updated="${s.updatedAt}">${ago(s.updatedAt)}</span>`;
      v.error.classList.add('hidden');
    }
    if (!v.renderer || !s.data) {
      if (!v.mounted && s.status === 'error') v.body.innerHTML = `<div class="empty">${icon(v.cfg.type)}<span>No data yet</span></div>`;
      continue;
    }
    const key = JSON.stringify(s.data);
    if (key === v.last) continue;
    v.last = key;
    try {
      v.renderer.update(v.body, s.data, v.cfg, api);
    } catch (e) {
      console.error(`[${id}] render failed`, e);
    }
  }
  const summary = document.getElementById('summary');
  summary.innerHTML = total === ok ? chip('good', `All ${total} sources OK`) : chip('crit', `${total - ok} of ${total} sources failing`);
  renderHeaderWeather(st);
}

/* ------------------------------ header ------------------------------ */

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}

function tick() {
  const now = new Date();
  document.getElementById('clock').textContent = now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: cfg.clock24h ? 'h23' : 'h12' });
  document.getElementById('date').textContent = `${now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · Week ${isoWeek(now)}`;
  document.querySelectorAll('[data-updated]').forEach((el) => (el.textContent = ago(Number(el.dataset.updated))));
}

function renderHeaderWeather(st) {
  const w = Object.values(st.panels).find((p) => p.type === 'weather' && p.data)?.data;
  const el = document.getElementById('header-weather');
  if (!w) return (el.innerHTML = '');
  const info = weatherInfo(w.current.code, w.current.isDay);
  const today = w.daily?.[0];
  el.innerHTML = `<span class="hw-icon">${info.icon}</span><span class="hw-temp">${isNum(w.current.temp) ? Math.round(w.current.temp) : '—'}°</span><span class="muted">${esc(info.text)}${today ? ` · ${Math.round(today.max)}° / ${Math.round(today.min)}°` : ''}</span>`;
}

tick();
setInterval(tick, 1000);
poll();
setInterval(poll, Math.max(1, cfg.pollInterval || 2) * 1000);

// Reload the page once a day to pick up config/code changes on an always-on screen.
setTimeout(() => location.reload(), 24 * 3600 * 1000);
