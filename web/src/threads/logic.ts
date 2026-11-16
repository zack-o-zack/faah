import type {
  Thread,
  ThreadTurn,
  ThreadSummary,
  ExplainTarget,
  ExplainInput,
  FileExplainTarget,
  PRExplainTarget,
} from './decode.ts';
import type { OpenOptions } from '../editor/types.ts';
export const isThreadRunning = (thread: Thread | null): boolean => !!thread?.turns?.at(-1)?.running;
export function explainRequest(info: ExplainTarget): Omit<ExplainTarget, 'text'>;
export function explainRequest(
  info: ExplainInput,
): Omit<ExplainTarget, 'text'> | FileExplainTarget | PRExplainTarget;
export function explainRequest(
  info: ExplainInput,
): Omit<ExplainTarget, 'text'> | FileExplainTarget | PRExplainTarget {
  if (info.pr) return { pr: true };
  if (info.file) return { path: info.path, file: true };
  const { path, l1, l2, c1, c2 } = info;
  const selected = info.text?.trim() || '';
  const symbol =
    info.symbol || (/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(selected) ? selected : undefined);
  return { path, l1, l2, c1, c2, ...(symbol ? { symbol } : {}) };
}
export function threadSummary(thread: Thread): ThreadSummary {
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
export function threadFileOptions(turn: ThreadTurn): OpenOptions | undefined {
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
export function relativeTime(ms: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - ms) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  return Math.floor(seconds / 86400) + 'd ago';
}
export function turnDuration(ms = 0): string {
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return Math.floor(ms / 60000) + 'm ' + Math.round((ms % 60000) / 1000) + 's';
}

// These labels mirror agents.StepLabel; the Go label test guards their exact wording.
export const EXPLAIN_STEP_LABELS = {
  notes: 'Show notes',
  walkthrough: 'Show a walkthrough',
} as const;
