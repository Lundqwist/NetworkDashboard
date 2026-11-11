// IP camera. Images are proxied through the server (see index.js) so camera
// credentials never reach the browser. The collector just checks reachability.
import { request } from '../lib/http.js';

export const defaultRefresh = 30;

export function cameraRequest(panel, url, opts = {}) {
  return request(url, {
    auth: panel.username ? { username: panel.username, password: panel.password } : undefined,
    headers: panel.headers,
    insecure: panel.insecure,
    timeout: opts.stream ? 15000 : panel.timeout ?? 8000,
    ...opts,
  });
}

export async function collect(panel, ctx) {
  if (!panel.snapshotUrl) return { mode: 'mjpeg', online: null };
  const res = await cameraRequest(panel, panel.snapshotUrl);
  if (res.status !== 200) throw new Error(`Camera answered HTTP ${res.status}`);
  // go2rtc answers 200 with an empty body when it can't reach the camera.
  if (!res.body.length) throw new Error('Camera returned no image (stream not reachable – check the camera account)');
  ctx.cache.lastSnapshot = { at: Date.now(), type: res.headers['content-type'], body: res.body };
  return { mode: panel.mjpegUrl ? 'mjpeg' : 'snapshot', online: true, bytes: res.body.length };
}
