// Small ring-buffer helpers so charts survive a browser reload.
export const HISTORY_POINTS = 60;

export function push(ctx, key, value, max = HISTORY_POINTS) {
  const h = (ctx.history[key] ??= []);
  h.push(value == null || Number.isNaN(value) ? null : Math.round(value * 10) / 10);
  if (h.length > max) h.splice(0, h.length - max);
  return h;
}

/** Records the standard host metrics and attaches them as `data.history`. */
export function withHostHistory(ctx, data) {
  const memPct = data.mem?.total ? (data.mem.used / data.mem.total) * 100 : null;
  push(ctx, 'cpu', data.cpu?.load);
  push(ctx, 'mem', memPct);
  push(ctx, 'temp', data.cpu?.temp);
  push(ctx, 'rx', data.net?.rx);
  push(ctx, 'tx', data.net?.tx);
  if (data.gpu) push(ctx, 'gpu', data.gpu.load);
  data.history = { ...ctx.history };
  return data;
}
