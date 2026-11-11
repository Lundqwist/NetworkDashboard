// One renderer per panel type. `update(body, data, cfg, api)` turns collected
// data into HTML; optional `mount(body, cfg, api)` runs once for panels that
// own interactive elements (camera, tasks, pi-hole buttons).
import {
  esc, isNum, pct, fmtPct, fmtNum, fmtBytes, fmtRate, fmtDuration, ago, level, chip, ring, meter, legend,
  lineChart, agoLabels, spanLabel, weatherInfo,
} from './ui.js';

const C = { s1: 'var(--s1)', s2: 'var(--s2)', s3: 'var(--s3)', s4: 'var(--s4)' };
const DEFAULT_REFRESH = { local: 3, agent: 5, glances: 5, synology: 15, pihole: 15, http: 60, network: 10 };
const interval = (cfg) => cfg.refresh ?? DEFAULT_REFRESH[cfg.type] ?? 5;

/* ================================ hosts ================================ */

function hostRings(d) {
  const memPct = pct(d.mem?.used, d.mem?.total);
  const t = d.cpu?.temp;
  const rings = [
    ring({ value: d.cpu?.load, label: 'CPU', text: fmtPct(d.cpu?.load), sub: d.cpu?.cores ? `${d.cpu.cores} threads` : d.load ? `load ${d.load[0]?.toFixed(2)}` : '', lvl: level(d.cpu?.load, 75, 90) }),
    ring({ value: memPct, label: 'Memory', text: fmtPct(memPct), sub: isNum(d.mem?.total) ? `${(d.mem.used / 1024 ** 3).toFixed(1)}/${Math.round(d.mem.total / 1024 ** 3)} GB` : '', lvl: level(memPct, 80, 92) }),
  ];
  if (d.gpu) {
    rings.push(ring({ value: d.gpu.load, label: 'GPU', text: fmtPct(d.gpu.load), sub: isNum(d.gpu.temp) ? `${Math.round(d.gpu.temp)} °C` : d.gpu.name?.replace(/NVIDIA GeForce |AMD Radeon /, '') || '', lvl: level(d.gpu.load, 85, 97) }));
  }
  rings.push(ring({ value: t, max: 100, label: 'Temp', text: isNum(t) ? `${Math.round(t)}°` : '—', sub: isNum(t) ? 'CPU °C' : 'no sensor', lvl: level(t, 70, 82) }));
  if (!d.gpu && d.disks?.[0]) {
    const dp = pct(d.disks[0].used, d.disks[0].total);
    rings.push(ring({ value: dp, label: 'Disk', text: fmtPct(dp), sub: `${fmtBytes(d.disks[0].total - d.disks[0].used, 0)} free`, lvl: level(dp, 85, 95) }));
  }
  return `<div class="rings">${rings.join('')}</div>`;
}

function loadChart(d, cfg, height) {
  const h = d.history || {};
  const n = h.cpu?.length || 0;
  const iv = interval(cfg);
  return `<div class="block">
    <div class="block-head"><span>Load · ${spanLabel(n, iv)}</span>${legend([{ name: 'CPU', color: C.s1 }, { name: 'Memory', color: C.s2 }])}</div>
    ${lineChart(
      [
        { name: 'CPU', values: h.cpu || [], color: C.s1 },
        { name: 'Memory', values: h.mem || [], color: C.s2 },
      ],
      { id: `${cfg.id}-load`, max: 100, height, fmt: (v) => `${v.toFixed(0)}%`, labels: agoLabels(n, iv) },
    )}
  </div>`;
}

function netChart(d, cfg, height) {
  const h = d.history || {};
  const n = h.rx?.length || 0;
  return `<div class="block">
    <div class="block-head"><span>Network · ↓ ${fmtRate(d.net?.rx)} · ↑ ${fmtRate(d.net?.tx)}</span>${legend([{ name: 'Down', color: C.s1 }, { name: 'Up', color: C.s2 }])}</div>
    ${lineChart(
      [
        { name: 'Down', values: h.rx || [], color: C.s1 },
        { name: 'Up', values: h.tx || [], color: C.s2 },
      ],
      { id: `${cfg.id}-net`, height, fmt: fmtRate, labels: agoLabels(n, interval(cfg)) },
    )}
  </div>`;
}

function coreBars(d) {
  const cores = d.cpu?.perCore || [];
  if (!cores.length) return '';
  return `<div class="block">
    <div class="block-head"><span>Per thread</span><span class="muted">${isNum(d.cpu?.speed) ? `${d.cpu.speed} GHz` : ''}</span></div>
    <div class="cores">${cores
      .map((v, i) => `<div class="core" data-tip="Thread ${i}: <b>${v}%</b>"><div class="core-fill ${level(v, 75, 90)}" style="height:${Math.max(2, v)}%"></div></div>`)
      .join('')}</div>
  </div>`;
}

function diskMeters(disks = []) {
  return disks
    .map((x) => {
      const p = pct(x.used, x.total);
      const status = x.status && !/normal/i.test(x.status) ? ` · ${x.status}` : '';
      return meter({ label: esc(x.mount), value: p, text: `${fmtBytes(x.used)} / ${fmtBytes(x.total)} · ${fmtPct(p)}${status}`, lvl: level(p, 85, 95) });
    })
    .join('');
}

function hostMeters(d) {
  const out = [];
  if (d.gpu && isNum(d.gpu.memTotal)) {
    out.push(meter({ label: `VRAM · ${esc(d.gpu.name || 'GPU')}`, value: pct(d.gpu.memUsed, d.gpu.memTotal), text: `${fmtBytes(d.gpu.memUsed)} / ${fmtBytes(d.gpu.memTotal, 0)}${isNum(d.gpu.power) ? ` · ${Math.round(d.gpu.power)} W` : ''}` }));
  }
  if (d.swap?.total) {
    const p = pct(d.swap.used, d.swap.total);
    out.push(meter({ label: 'Swap', value: p, text: `${fmtBytes(d.swap.used)} / ${fmtBytes(d.swap.total, 0)}`, lvl: level(p, 60, 85) }));
  }
  return out.join('');
}

function hostChips(d) {
  const chips = [];
  if (d.throttled) {
    if (d.throttled.now?.length) chips.push(chip('crit', d.throttled.now.join(', ')));
    else if (d.throttled.past?.length) chips.push(chip('warn', `Earlier: ${d.throttled.past.join(', ')}`));
    else chips.push(chip('good', 'No throttling'));
  }
  if (isNum(d.fan)) chips.push(chip('info', `Fan ${fmtNum(d.fan)} rpm`));
  if (isNum(d.cpu?.freq)) chips.push(chip('info', `${(d.cpu.freq / 1000).toFixed(1)} GHz`));
  if (d.load) chips.push(chip('info', `Load ${d.load.map((l) => (isNum(l) ? l.toFixed(2) : '—')).join(' ')}`));
  if (isNum(d.updates)) chips.push(d.updates > 0 ? chip('warn', `${d.updates} updates`) : chip('good', 'Up to date'));
  for (const s of d.services || []) chips.push(chip(s.active ? 'good' : 'crit', s.name, s.active ? 'active' : 'inactive'));
  for (const c of d.containers || []) chips.push(chip(c.state === 'running' ? 'good' : c.state === 'exited' ? 'crit' : 'idle', c.name, c.status));
  for (const dr of d.drives || []) {
    const bad = dr.status && !/normal|initialized/i.test(dr.status);
    chips.push(chip(bad ? 'crit' : 'good', `${dr.name}${isNum(dr.temp) ? ` ${dr.temp}°` : ''}`, [dr.model, dr.status, dr.smart].filter(Boolean).join(' · ')));
  }
  return chips.length ? `<div class="chips">${chips.join('')}</div>` : '';
}

function hostSub(d) {
  return `<div class="sub" title="${esc(d.hostname)}">${[d.model, d.os, isNum(d.uptime) ? `up ${fmtDuration(d.uptime)}` : null]
    .filter(Boolean)
    .map(esc)
    .join(' · ')}</div>`;
}

const host = {
  update(body, d, cfg) {
    const tall = cfg._rows > 1;
    body.innerHTML = `
      ${hostSub(d)}
      ${hostRings(d)}
      ${loadChart(d, cfg, tall ? 64 : 30)}
      ${tall ? netChart(d, cfg, 48) + coreBars(d) : ''}
      <div class="scroll stack">
        ${hostChips(d)}
        ${!tall && d.net ? `<div class="kv"><span>Network</span><b>↓ ${fmtRate(d.net.rx)} · ↑ ${fmtRate(d.net.tx)}</b></div>` : ''}
        ${diskMeters(d.disks)}
        ${hostMeters(d)}
      </div>`;
  },
};

/* ================================ pi-hole ================================ */

function stackedBars(history, id) {
  if (!history?.length) return '<div class="empty small">No history yet</div>';
  const W = 300;
  const H = 100;
  const gap = 2;
  const n = history.length;
  const bw = (W - gap * (n - 1)) / n;
  const max = Math.max(1, ...history.map((h) => h.total));
  const bars = history
    .map((h, i) => {
      const x = i * (bw + gap);
      const allowed = Math.max(0, h.total - h.blocked);
      const ha = (allowed / max) * (H - 2);
      const hb = (h.blocked / max) * (H - 2);
      const t = new Date(h.t * 1000);
      const label = `${t.getHours().toString().padStart(2, '0')}:00`;
      const tipHtml = `<div class='tt-head'>${label}</div><div class='tt-row'><i style='background:var(--s1)'></i><span>Allowed</span><b>${fmtNum(allowed)}</b></div><div class='tt-row'><i style='background:var(--s2)'></i><span>Blocked</span><b>${fmtNum(h.blocked)}</b></div>`;
      return `<g data-tip="${tipHtml}">
        <rect x="${x.toFixed(2)}" y="0" width="${bw.toFixed(2)}" height="${H}" fill="transparent"/>
        <rect x="${x.toFixed(2)}" y="${(H - ha).toFixed(2)}" width="${bw.toFixed(2)}" height="${ha.toFixed(2)}" fill="var(--s1)"/>
        ${hb > 0.5 ? `<rect x="${x.toFixed(2)}" y="${(H - ha - hb).toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.max(0, hb - gap).toFixed(2)}" fill="var(--s2)"/>` : ''}
      </g>`;
    })
    .join('');
  return `<div class="bars" id="${esc(id)}"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}<line x1="0" x2="${W}" y1="${H - 0.5}" y2="${H - 0.5}" class="axis"/></svg></div>`;
}

const pihole = {
  mount(body, cfg, api) {
    body.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-block]');
      if (!btn) return;
      btn.disabled = true;
      const [enabled, timer] = btn.dataset.block.split(':');
      await api.post(`/api/pihole/${cfg.id}/blocking`, { enabled: enabled === 'on', timer: Number(timer) || null });
      setTimeout(api.poll, 800);
    });
  },
  update(body, d, cfg) {
    const top = d.topBlocked || [];
    const maxTop = Math.max(1, ...top.map((t) => t.count));
    body.innerHTML = `
      <div class="row between">
        ${d.blocking ? chip('good', 'Blocking enabled') : chip('crit', d.blockingTimer ? `Blocking paused · ${Math.ceil(d.blockingTimer / 60)} min` : 'Blocking disabled')}
        <div class="btns">${d.blocking ? '<button data-block="off:300">Pause 5 min</button><button data-block="off:3600">1 h</button>' : '<button data-block="on">Enable</button>'}</div>
      </div>
      <div class="stats">
        <div class="stat"><div class="stat-val">${fmtNum(d.total)}</div><div class="stat-label">Queries (24 h)</div></div>
        <div class="stat"><div class="stat-val">${fmtNum(d.blocked)}</div><div class="stat-label">Blocked</div></div>
        <div class="stat"><div class="stat-val">${fmtPct(d.percent, 1)}</div><div class="stat-label">Blocked share</div></div>
        <div class="stat"><div class="stat-val">${fmtNum(d.clients)}</div><div class="stat-label">Active clients</div></div>
      </div>
      <div class="block">
        <div class="block-head"><span>Queries per hour</span>${legend([{ name: 'Allowed', color: C.s1 }, { name: 'Blocked', color: C.s2 }])}</div>
        ${stackedBars(d.history, `${cfg.id}-bars`)}
      </div>
      <div class="scroll toplist">
        ${top
          .map((t) => `<div class="top-row" title="${esc(t.domain)}"><span class="top-name">${esc(t.domain)}</span><span class="top-bar"><i style="width:${(t.count / maxTop) * 100}%"></i></span><b>${fmtNum(t.count)}</b></div>`)
          .join('')}
      </div>
      <div class="foot muted">${fmtNum(d.domains)} domains on blocklists${d.gravityUpdated ? ` · updated ${ago(d.gravityUpdated)}` : ''}</div>`;
  },
};

/* ================================ websites ================================ */

const http = {
  update(body, d, cfg) {
    const h = d.host;
    const hostBlock = h
      ? `<div class="mini-host">
          ${meter({ label: 'CPU', value: h.cpu?.load, text: fmtPct(h.cpu?.load), lvl: level(h.cpu?.load, 75, 90) })}
          ${meter({ label: 'Memory', value: pct(h.mem?.used, h.mem?.total), text: fmtPct(pct(h.mem?.used, h.mem?.total)), lvl: level(pct(h.mem?.used, h.mem?.total), 80, 92) })}
          ${h.disks?.[0] ? meter({ label: 'Disk', value: pct(h.disks[0].used, h.disks[0].total), text: fmtPct(pct(h.disks[0].used, h.disks[0].total)), lvl: level(pct(h.disks[0].used, h.disks[0].total), 85, 95) }) : ''}
        </div>
        <div class="sub">${esc(h.hostname || 'Server')} · ${isNum(h.uptime) ? `up ${fmtDuration(h.uptime)}` : ''}${isNum(h.cpu?.temp) ? ` · ${Math.round(h.cpu.temp)} °C` : ''}${h.containers?.length ? ` · ${h.containers.filter((c) => c.state === 'running').length}/${h.containers.length} containers` : ''}</div>`
      : d.hostError
        ? `<div class="sub">${chip('crit', 'Server metrics unavailable', d.hostError)}</div>`
        : '';
    const iv = interval(cfg);
    body.innerHTML = `
      ${hostBlock}
      <div class="scroll stack">
      ${(d.sites || [])
        .map((s, i) => {
          const certLvl = !isNum(s.certDays) ? '' : s.certDays < 7 ? 'crit' : s.certDays < 21 ? 'warn' : 'good';
          return `<div class="site">
            <div class="site-main">
              <div class="site-name">${s.ok ? chip('good', s.name) : chip('crit', s.name, s.error)}</div>
              <div class="site-meta">${[
                s.status ? `HTTP ${s.status}` : esc(s.error || 'down'),
                isNum(s.ms) ? `${s.ms} ms` : null,
                isNum(s.certDays) ? `<span class="t-${certLvl}">cert ${s.certDays} d</span>` : null,
                isNum(s.uptime) ? `${s.uptime.toFixed(s.uptime === 100 ? 0 : 1)}% up` : null,
              ]
                .filter(Boolean)
                .join(' · ')}</div>
            </div>
            <div class="site-spark">${lineChart([{ name: 'Response', values: s.history || [], color: C.s1 }], { id: `${cfg.id}-s${i}`, height: 30, fmt: (v) => `${Math.round(v)} ms`, labels: agoLabels((s.history || []).length, iv) })}</div>
          </div>`;
        })
        .join('')}
      </div>`;
  },
};

/* ================================ network ================================ */

const network = {
  update(body, d, cfg) {
    const devs = d.devices || [];
    const up = devs.filter((x) => x.up).length;
    const iv = interval(cfg);
    body.innerHTML = `
      <div class="row between">${up === devs.length ? chip('good', `All ${devs.length} reachable`) : chip('crit', `${devs.length - up} of ${devs.length} unreachable`)}<span class="muted small">latency · ${spanLabel(devs[0]?.history?.length || 0, iv)}</span></div>
      <div class="scroll stack tight">
        ${devs
          .map(
            (x, i) => `<div class="dev">
              <span class="dev-name">${chip(x.up ? 'good' : 'crit', x.name, x.host + (x.port ? `:${x.port}` : ''))}</span>
              <span class="dev-ms">${x.up ? `${x.ms < 10 ? x.ms.toFixed(1) : Math.round(x.ms)} ms` : 'down'}</span>
              <span class="dev-spark">${lineChart([{ name: x.name, values: x.history || [], color: C.s1 }], { id: `${cfg.id}-d${i}`, height: 20, area: false, fmt: (v) => `${v} ms`, labels: agoLabels((x.history || []).length, iv) })}</span>
            </div>`,
          )
          .join('')}
      </div>`;
  },
};

/* ================================ printer ================================ */

function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

const PRINTER_STATE = { idle: ['good', 'Idle'], printing: ['info', 'Printing'], paused: ['warn', 'Paused'], stopped: ['crit', 'Stopped'], error: ['crit', 'Error'], offline: ['idle', 'Offline'], unknown: ['idle', 'Unknown'] };

const printer = {
  update(body, d) {
    const [kind, label] = PRINTER_STATE[d.state] || PRINTER_STATE.unknown;
    if (d.kind === '3d') {
      body.innerHTML = `
        <div class="row between">${chip(kind, d.stateText || label)}<span class="muted small">${esc(d.name || '')}</span></div>
        ${d.file ? `<div class="sub" title="${esc(d.file)}">${esc(d.file)}</div>` : '<div class="sub">No active job</div>'}
        ${isNum(d.progress) ? meter({ label: 'Progress', value: d.progress, text: `${d.progress.toFixed(0)}%` }) : ''}
        <div class="stats three">
          <div class="stat"><div class="stat-val">${isNum(d.timeLeft) ? fmtDuration(d.timeLeft) : '—'}</div><div class="stat-label">Time left</div></div>
          <div class="stat"><div class="stat-val">${d.hotend ? `${Math.round(d.hotend.actual)}°` : '—'}</div><div class="stat-label">Hotend${d.hotend?.target ? ` → ${Math.round(d.hotend.target)}°` : ''}</div></div>
          <div class="stat"><div class="stat-val">${d.bed ? `${Math.round(d.bed.actual)}°` : '—'}</div><div class="stat-label">Bed${d.bed?.target ? ` → ${Math.round(d.bed.target)}°` : ''}</div></div>
        </div>`;
      return;
    }
    body.innerHTML = `
      <div class="row between">${chip(kind, label)}<span class="muted small">${d.jobs ? `${d.jobs} job${d.jobs > 1 ? 's' : ''} queued` : 'Queue empty'}</span></div>
      <div class="sub" title="${esc(d.model || '')}">${esc([d.model, d.message].filter(Boolean).join(' · '))}</div>
      ${d.reasons?.length ? `<div class="chips">${d.reasons.map((r) => chip(r.severity === 'error' ? 'crit' : r.severity === 'warning' ? 'warn' : 'info', r.text)).join('')}</div>` : ''}
      <div class="scroll stack">
        ${(d.markers || [])
          .map((m) => {
            const color = m.color && luminance(m.color) > 0.12 ? m.color : 'var(--ink-supply)';
            const low = isNum(m.level) && m.level <= (m.low || 10);
            return meter({
              label: `<i class="swatch" style="background:${m.color || 'transparent'}"></i>${esc(m.name)}`,
              value: m.level ?? (m.someRemaining ? 50 : 0),
              text: isNum(m.level) ? `${m.level}%${low ? ' · low' : ''}` : m.someRemaining ? 'OK' : 'unknown',
              color,
            });
          })
          .join('') || '<div class="empty small">Printer reports no supply levels</div>'}
      </div>`;
  },
};

/* ================================ weather ================================ */

const weather = {
  update(body, d, cfg) {
    const cur = d.current || {};
    const wi = weatherInfo(cur.code, cur.isDay);
    const hours = d.hourly || [];
    const fmtH = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const unit = d.units?.temp || '°C';
    body.innerHTML = `
      <div class="wx-now">
        <span class="wx-icon">${wi.icon}</span>
        <div><div class="wx-temp">${isNum(cur.temp) ? Math.round(cur.temp) : '—'}${esc(unit)}</div><div class="muted">${esc(wi.text)}${d.location ? ` · ${esc(d.location)}` : ''}</div></div>
        <div class="wx-facts">
          <div><span>Feels like</span><b>${isNum(cur.feels) ? Math.round(cur.feels) + '°' : '—'}</b></div>
          <div><span>Wind</span><b>${isNum(cur.wind) ? `${cur.wind.toFixed(0)} ${esc(d.units?.wind || '')}` : '—'}</b></div>
          <div><span>Humidity</span><b>${fmtPct(cur.humidity)}</b></div>
          <div><span>Sun</span><b>${d.sunrise ? fmtH(d.sunrise) : '—'} – ${d.sunset ? fmtH(d.sunset) : '—'}</b></div>
        </div>
      </div>
      <div class="block">
        <div class="block-head"><span>Next 24 h</span><span class="muted">hover for rain chance</span></div>
        ${lineChart([{ name: 'Temperature', values: hours.map((h) => h.temp), color: C.s4 }], {
          id: `${cfg.id}-hours`,
          height: 44,
          min: Math.min(...hours.map((h) => h.temp)) - 1,
          max: Math.max(...hours.map((h) => h.temp)) + 1,
          fmt: (v, i) => `${v.toFixed(1)}° · rain ${hours[i]?.pop ?? '—'}%`,
          labels: hours.map((h) => `${fmtH(h.t)} · ${weatherInfo(h.code).text}`),
        })}
        <div class="ticks">${hours.filter((_, i) => i % 6 === 0).map((h) => `<span>${fmtH(h.t)}</span>`).join('')}</div>
      </div>
      <div class="days">
        ${(d.daily || [])
          .slice(0, 6)
          .map((x, i) => {
            const w = weatherInfo(x.code);
            const name = i === 0 ? 'Today' : new Date(`${x.date}T12:00`).toLocaleDateString([], { weekday: 'short' });
            return `<div class="day" data-tip="${esc(`<div class='tt-head'>${name}</div>${w.text}<br>Rain chance ${x.pop ?? '—'}%`)}"><div class="muted">${esc(name)}</div><div class="day-icon">${w.icon}</div><div><b>${Math.round(x.max)}°</b> <span class="muted">${Math.round(x.min)}°</span></div><div class="muted small">${x.pop ?? 0}%</div></div>`;
          })
          .join('')}
      </div>`;
  },
};

/* ================================ camera ================================ */

const camera = {
  mount(body, cfg, api) {
    body.innerHTML = `<div class="cam"><img alt="${esc(cfg.title)}"><div class="cam-bar"><span class="cam-status"></span><span class="cam-time"></span></div><div class="cam-off hidden">Camera offline</div></div>`;
    const img = body.querySelector('img');
    const status = body.querySelector('.cam-status');
    const time = body.querySelector('.cam-time');
    const off = body.querySelector('.cam-off');
    const panel = body.closest('.panel');
    const setOnline = (ok) => {
      off.classList.toggle('hidden', ok);
      status.innerHTML = ok ? chip('good', cfg.stream ? 'Live' : 'Snapshot') : chip('crit', 'Offline');
    };

    panel.addEventListener('click', () => panel.classList.toggle('zoomed'));
    document.addEventListener('keydown', (e) => e.key === 'Escape' && panel.classList.remove('zoomed'));

    if (cfg.stream) {
      const connect = () => {
        img.src = `/api/camera/${cfg.id}/stream?t=${Date.now()}`;
      };
      img.onload = () => setOnline(true);
      img.onerror = () => {
        setOnline(false);
        setTimeout(connect, 10_000);
      };
      connect();
      setInterval(() => (time.textContent = new Date().toLocaleTimeString()), 1000);
      return;
    }

    let busy = false;
    const load = () => {
      if (busy || document.hidden) return;
      busy = true;
      const next = new Image();
      next.onload = () => {
        img.src = next.src;
        setOnline(true);
        time.textContent = new Date().toLocaleTimeString();
        busy = false;
      };
      next.onerror = () => {
        setOnline(false);
        busy = false;
      };
      next.src = `/api/camera/${cfg.id}/snapshot?t=${Date.now()}`;
    };
    load();
    setInterval(load, Math.max(1, cfg.refresh || 2) * 1000);
  },
  update() {},
};

/* ================================ tasks ================================ */

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** "Call plumber !  @tomorrow" -> { text, priority, due } */
export function parseTask(input) {
  let priority = false;
  let due = null;
  const words = input.split(/\s+/).filter((w) => {
    if (/^!+$/.test(w)) return !(priority = true);
    const m = /^@(.+)$/i.exec(w);
    if (!m) return true;
    const v = m[1].toLowerCase();
    const d = new Date();
    if (v === 'today') due = isoDate(d);
    else if (v === 'tomorrow' || v === 'tmr') due = isoDate(new Date(d.setDate(d.getDate() + 1)));
    else if (/^\+\d+$/.test(v)) due = isoDate(new Date(d.setDate(d.getDate() + Number(v.slice(1)))));
    else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) due = v;
    else if (WEEKDAYS.includes(v.slice(0, 3))) {
      const diff = (WEEKDAYS.indexOf(v.slice(0, 3)) - d.getDay() + 7) % 7 || 7;
      due = isoDate(new Date(d.setDate(d.getDate() + diff)));
    } else return true;
    return false;
  });
  return { text: words.join(' ').trim(), priority, due };
}

function dueChip(due) {
  if (!due) return '';
  const today = isoDate(new Date());
  const tomorrow = isoDate(new Date(Date.now() + 864e5));
  if (due < today) return chip('crit', 'Overdue', due);
  if (due === today) return chip('warn', 'Today');
  if (due === tomorrow) return chip('info', 'Tomorrow');
  return `<span class="due">${esc(new Date(`${due}T12:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }))}</span>`;
}

const tasks = {
  mount(body, cfg, api) {
    body.innerHTML = `
      <form class="task-form" autocomplete="off">
        <input name="t" placeholder="Add a task…   ! = important · @today @fri @2026-12-24" maxlength="300">
        <button type="submit">Add</button>
      </form>
      <ul class="task-list scroll"></ul>
      <div class="task-foot"><span class="muted small count"></span><button class="link" data-act="clear">Clear completed</button></div>`;
    const form = body.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const parsed = parseTask(form.t.value);
      if (!parsed.text) return;
      form.t.value = '';
      await api.post('/api/tasks', parsed);
      api.poll();
    });
    body.addEventListener('click', async (e) => {
      const el = e.target.closest('[data-act]');
      if (!el) return;
      const id = el.closest('[data-id]')?.dataset.id;
      const act = el.dataset.act;
      if (act === 'clear') await api.post('/api/tasks/clear-done');
      if (act === 'toggle') await api.patch(`/api/tasks/${id}`, { done: el.getAttribute('aria-checked') !== 'true' });
      if (act === 'star') await api.patch(`/api/tasks/${id}`, { priority: el.getAttribute('aria-pressed') !== 'true' });
      if (act === 'del') await api.del(`/api/tasks/${id}`);
      api.poll();
    });
  },
  update(body, d, cfg) {
    const list = d.tasks || [];
    const open = list.filter((t) => !t.done).length;
    const vikunja = cfg?.source === 'vikunja';
    body.querySelector('.count').textContent = `${open} open · ${list.length - open} done${vikunja ? ' · Vikunja' : ''}`;
    body.querySelector('.task-list').innerHTML =
      list
        .map(
          (t) => `<li class="task ${t.done ? 'done' : ''}" data-id="${esc(t.id)}">
            <button class="check" data-act="toggle" role="checkbox" aria-checked="${t.done}" title="${t.done ? 'Mark as open' : 'Mark as done'}">${t.done ? '✓' : ''}</button>
            <span class="task-text">${esc(t.text)}${t.repeats ? ' <span class="muted" title="Repeating task">↻</span>' : ''}${t.project ? ` <span class="muted small">· ${esc(t.project)}</span>` : ''}</span>
            ${t.done ? '' : dueChip(t.due)}
            <button class="star ${t.priority ? 'on' : ''}" data-act="star" aria-pressed="${t.priority}" title="Important">${t.priority ? '★' : '☆'}</button>
            ${vikunja ? '' : '<button class="del" data-act="del" title="Delete">✕</button>'}
          </li>`,
        )
        .join('') || '<li class="empty">Nothing to do 🎉</li>';
  },
};

export const renderers = { local: host, agent: host, glances: host, synology: host, pihole, http, network, printer, weather, camera, tasks };
