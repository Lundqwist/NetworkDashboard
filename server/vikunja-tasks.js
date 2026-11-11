// Task list backed by Vikunja (https://vikunja.io) instead of data/tasks.json.
// Same interface as TaskStore, so the /api/tasks routes and the tasks panel work unchanged.
//
// Panel config: { "type": "tasks", "source": "vikunja", "url": "http://vikunja:3456",
//                 "token": "${VIKUNJA_TOKEN}", "defaultProject": 1, "projects": [1, 2] }
//   defaultProject  project id that new tasks from the dashboard go to (default 1 = Inbox)
//   projects        optional: only show tasks from these project ids
//   refresh         seconds between syncs (default 30)
import { request, trimSlash } from './lib/http.js';

const NO_DATE = '0001-01-01T00:00:00Z';
const PRIORITY_HIGH = 3; // Vikunja 0–5; 3+ shows as ★ in the dashboard
const DAY = 864e5;

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "2026-11-12" -> local 09:00 with offset, like scripts\vikunja.ps1 does. */
function toVikunjaDue(due) {
  if (!due) return NO_DATE;
  const [y, m, d] = due.split('-').map(Number);
  const t = new Date(y, m - 1, d, 9, 0, 0);
  const off = -t.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${due}T09:00:00${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

const validDate = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

export class VikunjaStore {
  constructor(panel) {
    if (!panel.url) throw new Error('tasks: "url" is required for source "vikunja"');
    this.base = `${trimSlash(panel.url)}/api/v1`;
    this.token = panel.token;
    this.defaultProject = Number(panel.defaultProject ?? 1);
    this.projectFilter = Array.isArray(panel.projects) && panel.projects.length ? new Set(panel.projects.map(Number)) : null;
    this.refreshMs = Math.max(10, Number(panel.refresh) || 30) * 1000;
    this.tasks = [];
    this.projects = new Map();
    this.error = null;
    this.hiddenDoneBefore = 0; // "Clear completed" only hides them here; nothing is deleted in Vikunja
  }

  async api(method, path, body) {
    if (!this.token) throw new Error('Vikunja token missing (set VIKUNJA_TOKEN)');
    const res = await request(`${this.base}${path}`, {
      method,
      body,
      headers: { Authorization: `Bearer ${this.token}` },
      timeout: 10000,
    });
    if (res.status >= 400) {
      let msg = `HTTP ${res.status}`;
      try { msg = res.json().message || msg; } catch { /* not JSON */ }
      throw new Error(`Vikunja ${method} ${path.split('?')[0]}: ${msg}`);
    }
    return res.body.length ? res.json() : null;
  }

  async load() {
    await this.sync().catch(() => {});
    this.timer = setInterval(() => this.sync().catch(() => {}), this.refreshMs);
    this.timer.unref?.();
    return this;
  }

  async sync() {
    try {
      const [projects, tasks] = await Promise.all([
        this.api('GET', '/projects?per_page=200'),
        this.api('GET', `/tasks?per_page=500&filter=${encodeURIComponent('done = false || done_at > now-1d')}`),
      ]);
      this.projects = new Map((projects || []).map((p) => [p.id, p.title]));
      this.tasks = (tasks || []).filter((t) => !this.projectFilter || this.projectFilter.has(t.project_id)).map((t) => this.map(t));
      this.error = null;
    } catch (e) {
      this.error = e.message;
      throw e;
    }
  }

  map(t) {
    const hasDue = t.due_date && !t.due_date.startsWith('0001');
    const doneAt = t.done && t.done_at && !t.done_at.startsWith('0001') ? Date.parse(t.done_at) : null;
    return {
      id: String(t.id),
      text: t.title,
      done: !!t.done,
      priority: (t.priority || 0) >= PRIORITY_HIGH,
      due: hasDue ? localDate(new Date(t.due_date)) : null,
      project: this.projects.get(t.project_id) || null,
      repeats: !!(t.repeat_after || t.repeat_mode),
      created: Date.parse(t.created) || 0,
      completedAt: doneAt,
    };
  }

  list() {
    const visible = this.tasks.filter((t) => !t.done || (t.completedAt ?? 0) > Math.max(this.hiddenDoneBefore, Date.now() - DAY));
    const rank = (t) => [t.done ? 1 : 0, t.priority ? 0 : 1, t.due || '9999-99-99', t.created];
    return visible.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] < rb[i] ? -1 : 1;
      return 0;
    });
  }

  async add({ text, priority = false, due = null }) {
    const title = String(text || '').trim().slice(0, 300);
    if (!title) throw new Error('Task text is required');
    const body = { title, priority: priority ? PRIORITY_HIGH : 0 };
    if (validDate(due)) body.due_date = toVikunjaDue(due);
    const t = await this.api('PUT', `/projects/${this.defaultProject}/tasks`, body);
    await this.sync().catch(() => {});
    return this.map(t);
  }

  async update(id, patch) {
    if (!/^\d+$/.test(String(id))) return null;
    // Vikunja's update replaces the whole task, so fetch it, change only what was asked, send it back.
    let t;
    try {
      t = await this.api('GET', `/tasks/${id}`);
    } catch (e) {
      if (/HTTP 404|not exist/i.test(e.message)) return null;
      throw e;
    }
    if ('text' in patch) t.title = String(patch.text).trim().slice(0, 300) || t.title;
    if ('priority' in patch) t.priority = patch.priority ? Math.max(PRIORITY_HIGH, t.priority || 0) : 0;
    if ('due' in patch) t.due_date = toVikunjaDue(validDate(patch.due));
    if ('done' in patch) t.done = !!patch.done;
    const saved = await this.api('POST', `/tasks/${id}`, t);
    await this.sync().catch(() => {});
    return this.map(saved);
  }

  // Deleting from a wall dashboard is too easy to do by accident; delete in Vikunja itself.
  async remove() {
    return false;
  }

  async clearDone() {
    this.hiddenDoneBefore = Date.now();
  }
}
