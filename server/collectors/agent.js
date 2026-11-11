// Remote Linux host running agent/dashboard_agent.py (Raspberry Pi, server, Linux NAS).
import { request, trimSlash } from '../lib/http.js';
import { withHostHistory } from '../lib/history.js';

export const defaultRefresh = 5;

export async function collect(panel, ctx) {
  const headers = panel.token ? { Authorization: `Bearer ${panel.token}` } : {};
  const res = await request(`${trimSlash(panel.url)}/stats`, {
    headers,
    insecure: panel.insecure,
    timeout: panel.timeout ?? 5000,
  });
  if (res.status === 401) throw new Error('Agent rejected token');
  if (res.status !== 200) throw new Error(`Agent answered HTTP ${res.status}`);
  return withHostHistory(ctx, res.json());
}
