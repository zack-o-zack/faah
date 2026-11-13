import type { GitSnapshot } from '../workspace/decode.ts';
import type { SyncState } from './decode.ts';
export interface GitNotice {
  tone: string;
  title: string;
  text: string;
  choices: string[];
  log?: string;
  sync?: SyncState;
  job?: number;
}
export function cleanCommitMessage(text = ''): string {
  let result = text.trim();
  const fence =
    result.match(/```[\w-]*\r?\n([\s\S]*?)\r?\n```/) || result.match(/^```([\s\S]*?)```$/);
  if (fence) result = (fence[1] || '').trim();
  if (/^(["']).*\1$/s.test(result)) result = result.slice(1, -1).trim();
  return result;
}
export function gitCounts(snapshot: GitSnapshot = {}): {
  staged: number;
  changed: number;
  hasChanges: boolean;
  label: string;
} {
  const staged = Object.keys(snapshot.staged || {}).length;
  const changed = snapshot.gitChanges ?? Object.keys(snapshot.statuses || {}).length;
  return {
    staged,
    changed,
    hasChanges: changed > 0 || staged > 0,
    label: staged ? `${staged} of ${changed} staged` : `${changed} changed`,
  };
}
export function syncPlan({ ahead = 0, behind = 0 }: { ahead?: number; behind?: number } = {}): {
  pull: boolean;
  push: boolean;
} {
  return { pull: behind > 0 || ahead === 0, push: ahead > 0 };
}
export function syncNotice(state: SyncState, error = '', log = ''): GitNotice {
  const operation = state.inProgress || '';
  if (operation)
    return {
      tone: 'warn',
      title: `${operation} not finished`,
      text: `${state.branch || 'The branch'} is in the middle of a ${operation}. Abort to restore it, or let the harness finish resolving conflicts. ${error}`,
      choices: ['finish', 'abort'],
      sync: state,
      log,
    };
  return {
    tone: 'warn',
    title: "Can't fast-forward",
    text: `${state.branch || 'This branch'} has ${state.ahead || 0} local commits and ${state.behind || 0} incoming from ${state.upstream || 'upstream'}. Rebase replays local commits; merge joins histories. Nothing is pushed. ${error}`,
    choices: ['rebase', 'merge'],
    sync: state,
    log,
  };
}
export function commitIdentity(commit: { full?: string; hash: string }): string {
  return commit.full || commit.hash;
}
export const filePage = <T>(files: T[], count: number): T[] => files.slice(0, count);
