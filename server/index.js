import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import * as local from './collectors/local.js';
import * as agent from './collectors/agent.js';
import * as glances from './collectors/glances.js';
import * as synology from './collectors/synology.js';
import * as pihole from './collectors/pihole.js';
import * as httpCheck from './collectors/http.js';
import * as camera from './collectors/camera.js';
import * as printer from './collectors/printer.js';
import * as network from './collectors/network.js';
import * as weather from './collectors/weather.js';
import * as demo from './demo.js';
import { TaskStore } from './tasks.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DEMO = args.includes('--demo') || process.env.DEMO === '1';

/* ------------------------------ config ------------------------------ */

if (fs.existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env'));

function resolveConfigPath() {
  const i = args.indexOf('--config');
  if (i >= 0 && args[i + 1]) return path.resolve(args[i + 1]);
  if (process.env.DASHBOARD_CONFIG) return path.resolve(process.env.DASHBOARD_CONFIG);
  const own = path.join(ROOT, 'config.json');
  if (!DEMO && fs.existsSync(own)) return own;
  if (!DEMO) console.warn('[config] config.json not found – starting in demo mode with config.example.json');
  return path.join(ROOT, 'config.example.json');
}

// Replaces "${NAME}" in any string value with the environment variable NAME.
function expandEnv(v) {
  if (typeof v === 'string') return v.replace(/\$\{(\w+)\}/g, (_, k) => process.env[k] ?? '');
  if (Array.isArray(v)) return v.map(expandEnv);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expandEnv(x)]));
  return v;
}

const configPath = resolveConfigPath();
const demoMode = DEMO || configPath.endsWith('config.example.json');
const config = expandEnv(JSON.parse(fs.readFileSync(configPath, 'utf8')));
const panels = (config.panels || []).filter((p) => p.enabled !== false);
const panelsById = new Map(panels.map((p) => [p.id, p]));

/* ----------------------------- collectors ----------------------------- */

const collectors = { local, agent, glances, synology, pihole, http: httpCheck, camera, printer, network, weather };
const tasksFile = demoMode ? 'data/tasks.demo.json' : config.tasksFile || 'data/tasks.json';
const tasks = await new TaskStore(path.resolve(ROOT, tasksFile)).load();
if (demoMode && tasks.tasks.length === 0) {
  for (const t of [
    { text: 'Renew domain for the website', priority: true, due: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) },
    { text: 'Replace magenta toner', due: new Date().toISOString().slice(0, 10) },
    { text: 'Update Pi-hole blocklists' },
    { text: 'Check NAS backup to cloud' },
    { text: 'Flash new firmware on hallway camera' },
  ]) await tasks.add(t);
  await tasks.update(tasks.tasks[4].id, { done: true });
}

const state = new Map();
const contexts = new Map();
const timers = new Map();

function schedule(panel) {
  const mod = panel.type === 'tasks' ? null : demoMode ? demo : collectors[panel.type];
  const s = { id: panel.id, type: panel.type, status: 'pending', data: null, error: null, updatedAt: null };
  state.set(panel.id, s);
  if (panel.type === 'tasks') {
    s.status = 'ok';
    return;
  }
  if (!mod) {
    s.status = 'error';
    s.error = `Unknown panel type "${panel.type}"`;
    return;
  }
  const ctx = { history: {}, cache: {}, collectors };
  contexts.set(panel.id, ctx);
  const interval = demoMode ? Math.min(panel.refresh ?? 3, 3) : panel.refresh ?? collectors[panel.type].defaultRefresh ?? 10;

  const run = async () => {
    clearTimeout(timers.get(panel.id));
    try {
      s.data = await mod.collect(panel, ctx);
      s.status = 'ok';
      s.error = null;
    } catch (e) {
      s.status = 'error';
      s.error = e.message || String(e);
    }
    s.updatedAt = Date.now();
    timers.set(panel.id, setTimeout(run, interval * 1000));
  };
  s.refresh = run;
  run();
}
panels.forEach(schedule);

/* ------------------------------ http api ------------------------------ */

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

// Only non-secret, display-relevant options are sent to the browser.
const PUBLIC_KEYS = ['id', 'type', 'title', 'icon', 'refresh', 'protocol', 'location', 'aspect', 'mode'];
app.get('/api/config', (_req, res) => {
  res.json({
    title: config.title || 'Network Dashboard',
    locale: config.locale || null,
    clock24h: config.clock24h ?? true,
    pollInterval: config.pollInterval ?? 2,
    layout: config.layout,
    demo: demoMode,
    panels: panels.map((p) => ({
      ...Object.fromEntries(PUBLIC_KEYS.filter((k) => k in p).map((k) => [k, p[k]])),
      ...(p.type === 'camera' ? { stream: !!p.mjpegUrl && !demoMode, refresh: p.refresh ?? 2 } : {}),
    })),
  });
});

app.get('/api/state', (_req, res) => {
  const out = {};
  for (const [id, s] of state) {
    const { refresh, ...rest } = s;
    out[id] = s.type === 'tasks' ? { ...rest, data: { tasks: tasks.list() }, updatedAt: Date.now() } : rest;
  }
  res.set('Cache-Control', 'no-store').json({ time: Date.now(), panels: out });
});

app.post('/api/panels/:id/refresh', (req, res) => {
  const s = state.get(req.params.id);
  if (!s?.refresh) return res.status(404).json({ error: 'Unknown panel' });
  s.refresh();
  res.json({ ok: true });
});

/* camera proxy */
function cameraPanel(req, res) {
  const p = panelsById.get(req.params.id);
  if (!p || p.type !== 'camera') {
    res.status(404).end();
    return null;
  }
  return p;
}

app.get('/api/camera/:id/snapshot', async (req, res) => {
  const p = cameraPanel(req, res);
  if (!p) return;
  res.set('Cache-Control', 'no-store');
  if (demoMode) return res.type('image/svg+xml').send(demo.demoSnapshot(p.title));
  if (!p.snapshotUrl) return res.status(404).send('No snapshotUrl configured');
  try {
    const r = await camera.cameraRequest(p, p.snapshotUrl);
    if (r.status !== 200) return res.status(502).send(`Camera answered HTTP ${r.status}`);
    res.type(r.headers['content-type'] || 'image/jpeg').send(r.body);
  } catch (e) {
    res.status(502).send(e.message);
  }
});

app.get('/api/camera/:id/stream', async (req, res) => {
  const p = cameraPanel(req, res);
  if (!p) return;
  if (!p.mjpegUrl) return res.status(404).send('No mjpegUrl configured');
  try {
    const r = await camera.cameraRequest(p, p.mjpegUrl, { stream: true });
    if (r.status !== 200) {
      r.abort();
      return res.status(502).send(`Camera answered HTTP ${r.status}`);
    }
    res.status(200).set({ 'Content-Type': r.headers['content-type'] || 'multipart/x-mixed-replace', 'Cache-Control': 'no-store' });
    r.stream.pipe(res);
    req.on('close', () => r.abort());
  } catch (e) {
    res.status(502).send(e.message);
  }
});

/* pi-hole actions */
app.post('/api/pihole/:id/blocking', async (req, res) => {
  const p = panelsById.get(req.params.id);
  if (!p || p.type !== 'pihole') return res.status(404).json({ error: 'Unknown panel' });
  const enabled = !!req.body?.enabled;
  const timer = Number(req.body?.timer) || null;
  try {
    if (demoMode) contexts.get(p.id).cache.blocking = enabled;
    else await pihole.setBlocking(p, contexts.get(p.id), enabled, timer);
    state.get(p.id).refresh();
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* tasks */
app.get('/api/tasks', (_req, res) => res.json(tasks.list()));
app.post('/api/tasks', async (req, res) => {
  try {
    res.status(201).json(await tasks.add(req.body || {}));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post('/api/tasks/clear-done', async (_req, res) => {
  await tasks.clearDone();
  res.json({ ok: true });
});
app.patch('/api/tasks/:id', async (req, res) => {
  const t = await tasks.update(req.params.id, req.body || {});
  t ? res.json(t) : res.status(404).json({ error: 'Not found' });
});
app.delete('/api/tasks/:id', async (req, res) => {
  (await tasks.remove(req.params.id)) ? res.json({ ok: true }) : res.status(404).json({ error: 'Not found' });
});

const host = config.host || '127.0.0.1';
const port = Number(process.env.PORT || config.port || 3000);
app.listen(port, host, () => {
  console.log(`Network Dashboard ${demoMode ? '(DEMO MODE) ' : ''}running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  console.log(`Config: ${configPath}`);
});
