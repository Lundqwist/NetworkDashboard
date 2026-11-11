// Printers: any IPP/AirPrint network printer (ink/toner levels and status),
// or 3D printers via OctoPrint or Moonraker (Klipper/Mainsail/Fluidd).
import { execFile } from 'node:child_process';
import { getPrinterAttributes } from '../lib/ipp.js';
import { request, trimSlash } from '../lib/http.js';

export const defaultRefresh = 30;

const IPP_STATE = { 3: 'idle', 4: 'printing', 5: 'stopped' };

function humanReason(r) {
  const severity = /-error$/.test(r) ? 'error' : /-warning$/.test(r) ? 'warning' : 'info';
  const text = r.replace(/-(error|warning|report)$/, '').replace(/-/g, ' ');
  return { text: text.charAt(0).toUpperCase() + text.slice(1), severity };
}

async function ipp(panel) {
  const uri = panel.uri || `ipp://${panel.host}:${panel.port || 631}${panel.path || '/ipp/print'}`;
  const a = await getPrinterAttributes(uri, { timeout: panel.timeout ?? 6000 });
  const one = (k) => a[k]?.[0];
  const names = a['marker-names'] || [];
  const levels = a['marker-levels'] || [];
  const colors = a['marker-colors'] || [];
  const highs = a['marker-high-levels'] || [];
  const lows = a['marker-low-levels'] || [];
  return {
    kind: 'ipp',
    name: one('printer-info') || one('printer-name'),
    model: one('printer-make-and-model'),
    location: one('printer-location') || null,
    state: IPP_STATE[one('printer-state')] || 'unknown',
    message: one('printer-state-message') || null,
    accepting: one('printer-is-accepting-jobs') ?? null,
    jobs: one('queued-job-count') ?? 0,
    reasons: (a['printer-state-reasons'] || []).filter((r) => r && r !== 'none').map(humanReason),
    markers: names.map((name, i) => {
      const high = highs[i] > 0 ? highs[i] : 100;
      const lvl = levels[i];
      return {
        name,
        // -1 = unavailable, -2 = unknown, -3 = "some remaining"
        level: lvl >= 0 ? Math.round((lvl / high) * 100) : null,
        someRemaining: lvl === -3,
        low: lows[i] ?? 10,
        color: (colors[i] || '').split('#').filter(Boolean)[0] ? `#${colors[i].split('#').filter(Boolean)[0]}` : null,
      };
    }),
  };
}

async function octoprint(panel) {
  const base = trimSlash(panel.url);
  const headers = { 'X-Api-Key': panel.apiKey };
  const [p, j] = await Promise.all([
    request(`${base}/api/printer`, { headers, insecure: panel.insecure }),
    request(`${base}/api/job`, { headers, insecure: panel.insecure }),
  ]);
  if (j.status === 403 || p.status === 403) throw new Error('OctoPrint rejected API key');
  const printer = p.status === 200 ? p.json() : null;
  const job = j.status === 200 ? j.json() : {};
  const t = printer?.temperature || {};
  const text = printer?.state?.text || job.state || 'Offline';
  return {
    kind: '3d',
    name: panel.title,
    state: /printing/i.test(text) ? 'printing' : /paus/i.test(text) ? 'paused' : /error/i.test(text) ? 'error' : /offline|closed/i.test(text) ? 'offline' : 'idle',
    stateText: text,
    file: job.job?.file?.display || job.job?.file?.name || null,
    progress: job.progress?.completion ?? null,
    timeLeft: job.progress?.printTimeLeft ?? null,
    elapsed: job.progress?.printTime ?? null,
    hotend: t.tool0 ? { actual: t.tool0.actual, target: t.tool0.target } : null,
    bed: t.bed ? { actual: t.bed.actual, target: t.bed.target } : null,
  };
}

async function moonraker(panel) {
  const base = trimSlash(panel.url);
  const headers = panel.apiKey ? { 'X-Api-Key': panel.apiKey } : {};
  const res = await request(`${base}/printer/objects/query?print_stats&virtual_sdcard&extruder&heater_bed&display_status`, {
    headers,
    insecure: panel.insecure,
  });
  if (res.status !== 200) throw new Error(`Moonraker answered HTTP ${res.status}`);
  const s = res.json().result.status;
  const progress = (s.display_status?.progress ?? s.virtual_sdcard?.progress ?? 0) * 100;
  const elapsed = s.print_stats?.print_duration ?? null;
  const state = s.print_stats?.state || 'standby';
  return {
    kind: '3d',
    name: panel.title,
    state: { printing: 'printing', paused: 'paused', error: 'error', complete: 'idle', cancelled: 'idle', standby: 'idle' }[state] || state,
    stateText: state.charAt(0).toUpperCase() + state.slice(1),
    file: s.print_stats?.filename || null,
    progress: state === 'printing' || state === 'paused' ? progress : null,
    elapsed,
    timeLeft: progress > 1 && elapsed ? (elapsed / progress) * 100 - elapsed : null,
    hotend: s.extruder ? { actual: s.extruder.temperature, target: s.extruder.target } : null,
    bed: s.heater_bed ? { actual: s.heater_bed.temperature, target: s.heater_bed.target } : null,
  };
}

/* ----------------- Windows print queue (USB printers, no admin needed) ----------------- */

// Win32_Printer.DetectedErrorState -> text and severity (2 = no error, 0/1 = unknown/other).
const WIN_ERRORS = {
  3: ['Low paper', 'warning'], 4: ['No paper', 'error'], 5: ['Low toner', 'warning'], 6: ['No toner', 'error'],
  7: ['Door open', 'error'], 8: ['Paper jam', 'error'], 9: ['Offline', 'error'], 10: ['Service requested', 'error'],
  11: ['Output bin full', 'warning'],
};
// Win32_Printer.PrinterStatus
const WIN_STATUS = { 3: 'idle', 4: 'printing', 5: 'printing', 6: 'stopped', 7: 'offline' };

function powershell(script, timeout = 15000) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout, windowsHide: true, maxBuffer: 1e6 },
      (err, stdout) => (err ? reject(new Error(`Printer query failed: ${err.message.split('\n')[0]}`)) : resolve(String(stdout))),
    );
  });
}

async function windowsPrinter(panel) {
  if (process.platform !== 'win32') throw new Error('protocol "windows" only works when the dashboard runs on Windows');
  const name = String(panel.name || '').replace(/'/g, "''");
  if (!name) throw new Error('Set "name" to the Windows printer name (see Get-Printer)');
  const out = await powershell(`
    [Console]::OutputEncoding = [Text.Encoding]::UTF8
    $p = Get-CimInstance Win32_Printer -Filter "Name='${name.replace(/"/g, '')}'"
    if (-not $p) { '{"missing":true}'; exit }
    $jobs = @(Get-PrintJob -PrinterName '${name}' -ErrorAction SilentlyContinue)
    $dev = Get-PnpDevice -Class Printer -PresentOnly -ErrorAction SilentlyContinue | Where-Object FriendlyName -eq $p.DriverName | Select-Object -First 1
    [pscustomobject]@{
      driver = $p.DriverName; port = $p.PortName; status = $p.PrinterStatus; error = $p.DetectedErrorState
      offline = [bool]$p.WorkOffline; jobs = $jobs.Count
      jobErrors = @($jobs | Where-Object { $_.JobStatus -match 'Error|Blocked|Paper' }).Count
      connected = if ($p.PortName -like 'USB*') { [bool]$dev } else { $true }
    } | ConvertTo-Json -Compress`);
  const j = JSON.parse(out.trim() || '{}');
  if (j.missing) throw new Error(`Windows has no printer named "${panel.name}"`);
  const reasons = [];
  if (WIN_ERRORS[j.error]) reasons.push({ text: WIN_ERRORS[j.error][0], severity: WIN_ERRORS[j.error][1] });
  if (!j.connected) reasons.push({ text: 'USB printer not connected or switched off', severity: 'error' });
  if (j.jobErrors) reasons.push({ text: `${j.jobErrors} job${j.jobErrors > 1 ? 's' : ''} with errors`, severity: 'error' });
  let state = WIN_STATUS[j.status] || (j.jobs ? 'printing' : 'idle');
  if (j.offline || !j.connected) state = 'offline';
  else if (reasons.some((r) => r.severity === 'error')) state = 'error';
  return {
    kind: 'ipp',
    name: panel.name,
    model: j.driver,
    location: j.port,
    state,
    message: j.port ? `on ${j.port}` : null,
    jobs: j.jobs || 0,
    reasons,
    // Windows' print API exposes no toner levels for USB printers.
    markers: [],
  };
}

export async function collect(panel) {
  switch (panel.protocol || 'ipp') {
    case 'ipp':
      return ipp(panel);
    case 'windows':
      return windowsPrinter(panel);
    case 'octoprint':
      return octoprint(panel);
    case 'moonraker':
      return moonraker(panel);
    default:
      throw new Error(`Unknown printer protocol "${panel.protocol}"`);
  }
}
