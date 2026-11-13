export const isThreadRunning = (thread) => !!thread?.turns?.at(-1)?.running;
export function explainRequest(info) {
  const { path, l1, l2, c1, c2, text } = info;
  return { path, l1, l2, c1, c2, text };
}
export function threadSummary(thread) {
  const last = thread.turns?.at(-1);
  return {
    id: thread.id,
    title: thread.title,
    path: thread.path || '',
    l1: thread.l1 || 0,
    l2: thread.l2 || 0,
    kind: thread.kind || '',
    updated: thread.updated || Date.now(),
    turns: thread.turns?.length || 0,
    running: !!last?.running,
    failed: !!last?.error,
    touched: !!last?.changed?.length || last?.tracked === false,
  };
}
export function threadFileOptions(turn) {
  return turn.beforeSha && turn.afterSha && !turn.reverted
    ? {
        ref: turn.afterSha,
        base: turn.beforeSha,
        turnFiles: turn.changed,
        turnLabel: 'Turn #' + turn.id,
        view: 'diff',
      }
    : undefined;
}
export function relativeTime(ms, now) {
  const seconds = Math.max(0, Math.floor((now - ms) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  return Math.floor(seconds / 86400) + 'd ago';
}
export function turnDuration(ms = 0) {
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return Math.floor(ms / 60000) + 'm ' + Math.round((ms % 60000) / 1000) + 's';
}
