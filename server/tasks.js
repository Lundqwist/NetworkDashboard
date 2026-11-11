// Local task list persisted to data/tasks.json.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export class TaskStore {
  constructor(file) {
    this.file = file;
    this.tasks = [];
    this.writing = Promise.resolve();
  }

  async load() {
    try {
      this.tasks = JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn(`[tasks] could not read ${this.file}: ${e.message}`);
      this.tasks = [];
    }
    return this;
  }

  save() {
    const data = JSON.stringify(this.tasks, null, 2);
    this.writing = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fs.writeFile(tmp, data);
      await fs.rename(tmp, this.file);
    });
    return this.writing;
  }

  list() {
    const rank = (t) => [t.done ? 1 : 0, t.priority ? 0 : 1, t.due || '9999-99-99', t.created];
    return [...this.tasks].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] < rb[i] ? -1 : 1;
      return 0;
    });
  }

  async add({ text, priority = false, due = null }) {
    const clean = String(text || '').trim().slice(0, 300);
    if (!clean) throw new Error('Task text is required');
    const task = { id: crypto.randomUUID(), text: clean, done: false, priority: !!priority, due: validDate(due), created: Date.now(), completedAt: null };
    this.tasks.push(task);
    await this.save();
    return task;
  }

  async update(id, patch) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return null;
    if ('text' in patch) t.text = String(patch.text).trim().slice(0, 300) || t.text;
    if ('priority' in patch) t.priority = !!patch.priority;
    if ('due' in patch) t.due = validDate(patch.due);
    if ('done' in patch) {
      t.done = !!patch.done;
      t.completedAt = t.done ? Date.now() : null;
    }
    await this.save();
    return t;
  }

  async remove(id) {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((x) => x.id !== id);
    if (this.tasks.length !== before) await this.save();
    return before !== this.tasks.length;
  }

  async clearDone() {
    this.tasks = this.tasks.filter((x) => !x.done);
    await this.save();
  }
}

function validDate(d) {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}
