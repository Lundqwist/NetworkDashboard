// Formatting helpers and small SVG/HTML components shared by all panels.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const pct = (used, total) => (isNum(used) && isNum(total) && total > 0 ? (used / total) * 100 : null);
export const fmtPct = (v, d = 0) => (isNum(v) ? `${v.toFixed(d)}%` : '—');
export const fmtNum = (v) => (isNum(v) ? Math.round(v).toLocaleString() : '—');

export function fmtBytes(b, d = 1) {
  if (!isNum(b)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  while (Math.abs(b) >= 1024 && i < units.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b.toFixed(i === 0 || b >= 100 ? 0 : d)} ${units[i]}`;
}
export const fmtRate = (b) => (isNum(b) ? `${fmtBytes(b)}/s` : '—');

export function fmtDuration(s) {
  if (!isNum(s)) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export function ago(ms) {
  if (!ms) return '';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 5) return 'now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Maps a value to a status level using warning/critical thresholds. */
export function level(v, warn, crit) {
  if (!isNum(v)) return '';
  if (v >= crit) return 'crit';
  if (v >= warn) return 'warn';
  return '';
}

const STATUS_ICON = { good: '●', warn: '▲', crit: '✕', info: '●', idle: '○' };
/** Status chip – always icon + label, never color alone. */
export function chip(kind, text, title = '') {
  return `<span class="chip ${kind}"${title ? ` title="${esc(title)}"` : ''}><i>${STATUS_ICON[kind] || '●'}</i>${esc(text)}</span>`;
}

export function ring({ value, max = 100, label, text, sub = '', lvl = '' }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const f = isNum(value) ? Math.max(0, Math.min(1, value / max)) : 0;
  return `<div class="ring ${lvl}">
    <div class="ring-gauge">
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle class="track" cx="24" cy="24" r="${r}"/>
        ${f > 0 ? `<circle class="fill" cx="24" cy="24" r="${r}" stroke-dasharray="${(f * c).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 24 24)"/>` : ''}
      </svg>
      <span class="ring-val">${esc(text)}</span>
    </div>
    <div class="ring-text"><div class="ring-label">${esc(label)}</div><div class="ring-sub" title="${esc(sub)}">${esc(sub)}</div></div>
  </div>`;
}

export function meter({ label, value, text, lvl = '', color = null, title = '' }) {
  const w = isNum(value) ? Math.max(0, Math.min(100, value)) : 0;
  return `<div class="meter"${title ? ` title="${esc(title)}"` : ''}>
    <div class="meter-top"><span class="meter-label">${label}</span><span class="meter-text">${esc(text)}</span></div>
    <div class="meter-track"><div class="meter-fill ${lvl}" style="width:${w}%${color ? `;background:${color}` : ''}"></div></div>
  </div>`;
}

export function legend(items) {
  return `<span class="legend">${items.map((i) => `<span><i style="background:${i.color}"></i>${esc(i.name)}</span>`).join('')}</span>`;
}

/* ------------------------------ charts ------------------------------ */

// Chart data lives here (keyed by a stable id) so the hover layer can read it.
export const chartStore = new Map();

/**
 * Line/area chart. `series`: [{ name, values, color }]. Nulls create gaps.
 * opts: { id, height, min, max, fmt(v), labels[] (per point, for tooltips), area }
 */
export function lineChart(series, opts) {
  const W = 300;
  const H = 100;
  const all = series.flatMap((s) => s.values).filter(isNum);
  const min = opts.min ?? 0;
  const max = opts.max ?? Math.max(min + 1e-9, ...(all.length ? all : [1])) * 1.12;
  const n = Math.max(2, ...series.map((s) => s.values.length));
  const x = (i) => (i / (n - 1)) * W;
  const y = (v) => H - ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * (H - 4) - 2;

  const paths = series
    .map((s) => {
      const offset = n - s.values.length;
      const segs = [];
      let cur = [];
      s.values.forEach((v, i) => {
        if (isNum(v)) cur.push([x(i + offset), y(v)]);
        else if (cur.length) {
          segs.push(cur);
          cur = [];
        }
      });
      if (cur.length) segs.push(cur);
      return segs
        .map((pts) => {
          if (pts.length === 1) pts = [pts[0], [pts[0][0] + 1, pts[0][1]]];
          const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
          const areaD = `${d}L${pts.at(-1)[0].toFixed(1)},${H}L${pts[0][0].toFixed(1)},${H}Z`;
          return `${opts.area !== false ? `<path d="${areaD}" fill="${s.color}" fill-opacity="0.14" stroke="none"/>` : ''}<path d="${d}" stroke="${s.color}" class="line"/>`;
        })
        .join('');
    })
    .join('');

  chartStore.set(opts.id, { series, fmt: opts.fmt || ((v) => v), labels: opts.labels, n });
  return `<div class="chart" data-chart="${esc(opts.id)}" style="height:${opts.height || 40}px">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="grid"/>
      <line x1="0" x2="${W}" y1="${H - 0.5}" y2="${H - 0.5}" class="axis"/>
      ${paths}
    </svg>
    <div class="xh"></div>
  </div>`;
}

/** Relative "x ago" labels for a history buffer sampled every `intervalSec`. */
export function agoLabels(len, intervalSec) {
  return Array.from({ length: len }, (_, i) => {
    const s = (len - 1 - i) * intervalSec;
    return s === 0 ? 'now' : s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
  });
}

export function spanLabel(points, intervalSec) {
  const s = points * intervalSec;
  return s < 120 ? `last ${s}s` : s < 7200 ? `last ${Math.round(s / 60)} min` : `last ${Math.round(s / 3600)} h`;
}

/* ------------------------------ tooltip ------------------------------ */

const tip = document.createElement('div');
tip.className = 'tooltip';
document.body.appendChild(tip);

function showTip(html, ev) {
  tip.innerHTML = html;
  tip.style.display = 'block';
  const r = tip.getBoundingClientRect();
  let left = ev.clientX + 14;
  let top = ev.clientY + 14;
  if (left + r.width > innerWidth - 6) left = ev.clientX - r.width - 14;
  if (top + r.height > innerHeight - 6) top = ev.clientY - r.height - 14;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}
const hideTip = () => {
  tip.style.display = 'none';
};

document.addEventListener('mousemove', (ev) => {
  const chartEl = ev.target.closest?.('.chart[data-chart]');
  document.querySelectorAll('.chart .xh.on').forEach((el) => el !== chartEl?.querySelector('.xh') && el.classList.remove('on'));
  if (chartEl) {
    const d = chartStore.get(chartEl.dataset.chart);
    if (!d) return hideTip();
    const rect = chartEl.getBoundingClientRect();
    const i = Math.round(((ev.clientX - rect.left) / rect.width) * (d.n - 1));
    const idx = Math.max(0, Math.min(d.n - 1, i));
    const xh = chartEl.querySelector('.xh');
    xh.style.left = `${(idx / (d.n - 1)) * 100}%`;
    xh.classList.add('on');
    const rows = d.series
      .map((s) => {
        const v = s.values[idx - (d.n - s.values.length)];
        return `<div class="tt-row"><i style="background:${s.color}"></i><span>${esc(s.name)}</span><b>${isNum(v) ? esc(d.fmt(v, idx)) : '—'}</b></div>`;
      })
      .join('');
    return showTip(`${d.labels?.[idx] ? `<div class="tt-head">${esc(d.labels[idx])}</div>` : ''}${rows}`, ev);
  }
  const tipEl = ev.target.closest?.('[data-tip]');
  if (tipEl) return showTip(tipEl.dataset.tip, ev);
  hideTip();
});
document.addEventListener('mouseleave', hideTip);

/* ------------------------------ icons ------------------------------ */

const ICONS = {
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z"/>',
  camera: '<path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>',
  printer: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
  tasks: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/>',
  network: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
};
const TYPE_ICON = { local: 'monitor', agent: 'chip', glances: 'server', synology: 'database', pihole: 'shield', http: 'globe', camera: 'camera', printer: 'printer', tasks: 'tasks', network: 'network', weather: 'cloud' };

export function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS[TYPE_ICON[name]] || ICONS.server}</svg>`;
}

/* ------------------------------ weather ------------------------------ */

export function weatherInfo(code, isDay = true) {
  const W = [
    [[0], isDay ? '☀️' : '🌙', 'Clear'],
    [[1], isDay ? '🌤️' : '🌙', 'Mainly clear'],
    [[2], '⛅', 'Partly cloudy'],
    [[3], '☁️', 'Overcast'],
    [[45, 48], '🌫️', 'Fog'],
    [[51, 53, 55, 56, 57], '🌦️', 'Drizzle'],
    [[61, 63, 65, 66, 67], '🌧️', 'Rain'],
    [[71, 73, 75, 77], '🌨️', 'Snow'],
    [[80, 81, 82], '🌦️', 'Showers'],
    [[85, 86], '🌨️', 'Snow showers'],
    [[95, 96, 99], '⛈️', 'Thunderstorm'],
  ];
  const hit = W.find(([codes]) => codes.includes(code));
  return hit ? { icon: hit[1], text: hit[2] } : { icon: '🌡️', text: '—' };
}
