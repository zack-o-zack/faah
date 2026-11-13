import type { WorkspaceMeta } from '../app/types.ts';
import type {
  PRMeta,
  PRComment,
  Draft,
  CommentThread,
  MergeInfo,
  SyncContext,
  MergeStatus,
  MergePill,
  ForgeReply,
  ForgeInfo,
} from './types.ts';
interface ComposerInput {
  path: string;
  l1: number;
  l2: number;
  side?: string;
  delL1?: number;
  delL2?: number;
}
// The forge's own state colours, so a glance reads the same as on the forge.
export const PR_STATES = {
  open: {
    label: 'Open',
    icon: 'icon-[lucide--git-pull-request]',
    color: 'text-[#1a7f37] dark:text-[#3fb950]',
  },
  draft: {
    label: 'Draft',
    icon: 'icon-[lucide--git-pull-request-draft]',
    color: 'text-muted-foreground',
  },
  merged: {
    label: 'Merged',
    icon: 'icon-[lucide--git-merge]',
    color: 'text-[#8250df] dark:text-[#a371f7]',
  },
  closed: {
    label: 'Closed',
    icon: 'icon-[lucide--git-pull-request-closed]',
    color: 'text-[#cf222e] dark:text-[#f85149]',
  },
};

export function prState(meta: PRMeta): keyof typeof PR_STATES {
  if (meta.merged) return 'merged';
  if (meta.state === 'closed') return 'closed';
  return meta.draft ? 'draft' : 'open';
}

export const prEnded = (meta: PRMeta): boolean => !!meta.merged || meta.state === 'closed';

const DEFAULT_FORGE = {
  label: 'GitHub',
  tokenKey: 'github.token',
  tokenCategory: 'GitHub',
  tokenHint: 'set GITHUB_TOKEN, set GH_TOKEN, or run `gh auth login`',
};
/** The forge this workspace talks to; GitHub when the server does not say. */
export const forgeInfo = (meta: Partial<WorkspaceMeta> | null | undefined): ForgeInfo =>
  meta?.forge?.info || DEFAULT_FORGE;

export const pluralize = (n: number, word: string): string => n + ' ' + word + (n === 1 ? '' : 's');
const capitalize = (text: string): string =>
  text ? (text[0] || '').toUpperCase() + text.slice(1) : text;

export function formatTime(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** One line of what a reader sees first: no HTML, Markdown markers or alert labels. */
export function commentPreview(body?: string): string {
  return (body || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/gi, ' ')
    .replace(/^[\s>#*-]+/gm, '')
    .replace(/[`*_|]|-{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const threadKey = (
  path: string,
  side: string | undefined,
  line: number | undefined,
): string => `${path}|${side || 'RIGHT'}:${line}`;
const byTime = (a: { createdAt?: string }, b: { createdAt?: string }): number =>
  (a.createdAt || '').localeCompare(b.createdAt || '');

/**
 * Posted review comments and local drafts grouped into threads by path, side and
 * line: a reply carries its root's location, so the key gathers a whole thread.
 */
export function commentThreads(
  reviewComments: PRComment[],
  drafts: Partial<Draft>[],
): CommentThread[] {
  const threads = new Map<string, CommentThread>();
  const threadFor = (comment: Partial<PRComment>): CommentThread => {
    const side = comment.side || 'RIGHT';
    const key = threadKey(comment.path || '', side, comment.line);
    if (!threads.has(key))
      threads.set(key, {
        key,
        path: comment.path || '',
        side,
        line: comment.line || 0,
        existing: [],
        drafts: [],
      });
    const thread = threads.get(key);
    if (!thread) throw new Error('Missing comment thread');
    return thread;
  };
  for (const comment of reviewComments) if (comment.path) threadFor(comment).existing.push(comment);
  for (const draft of drafts) if (draft.path) threadFor(draft).drafts.push(draft);
  return [...threads.values()]
    .map((thread) => {
      const existing = thread.existing.slice().sort(byTime);
      const root = existing.find((comment) => !comment.inReplyTo) || existing[0] || null;
      return { ...thread, existing, root };
    })
    .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

export const sortedByTime = <T extends { createdAt?: string }>(comments: T[]): T[] =>
  comments.slice().sort(byTime);

/** Comment counts per diff line key, for gutter markers. */
export function markerCounts(
  reviewComments: Pick<PRComment, 'path' | 'line' | 'side'>[],
  drafts: Pick<PRComment, 'path' | 'line' | 'side'>[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const comment of [...reviewComments, ...drafts]) {
    if (!comment.path) continue;
    const key = threadKey(comment.path || '', comment.side, comment.line);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/** The side and line a diff row is commented on; deleted lines sit on the base. */
export function rowTarget(
  row: { oldLine?: number; newLine?: number; at?: number } | null | undefined,
): { side: string; line: number } | null {
  if (!row) return null;
  if (row.newLine === undefined && row.oldLine !== undefined)
    return { side: 'LEFT', line: row.oldLine };
  if (row.newLine === undefined) return null;
  return { side: 'RIGHT', line: row.newLine };
}

/** Where a new draft goes, from a diff selection. */
export function composerTarget(info: ComposerInput): {
  path: string;
  side: string;
  line: number;
  label: string;
} {
  const side = info.side || 'RIGHT';
  const line = side === 'LEFT' ? info.delL1 || info.l1 : info.l1;
  const end = side === 'LEFT' ? info.delL2 || info.l2 : info.l2;
  const range = line === end ? String(line) : `${line}-${end}`;
  return {
    path: info.path,
    side,
    line,
    label: `${info.path}:${range}${side === 'LEFT' ? ' (base)' : ''}`,
  };
}

export const applicableDrafts = (drafts: Draft[]): Draft[] =>
  drafts.filter((draft) => draft.path && draft.line && draft.body?.trim());

export const draftsNote = (count: number): string =>
  count
    ? `Your ${count} line comment${count === 1 ? '' : 's'} go${count === 1 ? 'es' : ''} with it.`
    : 'No line comments yet. Select lines in the diff to add some.';

/**
 * Why the review verdict buttons can't be used right now. The checkout's own
 * state comes first: while a rebase runs or sits unpushed, the forge still holds
 * the old commits, and approving would approve those.
 */
export function reviewGate(
  sync: SyncContext,
  mergeState: string,
  base: string,
): { all: string; approve: string; approveNote: string } {
  const gate = { all: '', approve: '', approveNote: '' };
  if (sync.running) gate.all = 'Wait for the rebase to finish';
  else if (sync.inProgress) gate.all = `Finish or abort the ${sync.inProgress} first`;
  else if (sync.rewritten)
    gate.approve =
      'Force-push the rebased branch first: approving now would approve the old commits';
  else if (mergeState === 'conflicts')
    gate.approveNote = `This PR conflicts with ${base}; approving won't make it mergeable until the conflicts are resolved`;
  return gate;
}

/**
 * One word on whether this PR can merge, and the next step when it can't. The
 * checkout's local state overrides the forge's, since it is what the forge sees next.
 */
export function mergePill(
  sync: SyncContext,
  status: MergeStatus | null | undefined,
  base: string,
): MergePill | null {
  if (sync.running)
    return {
      tone: 'busy',
      text: 'Rebasing...',
      title: 'The harness is bringing the branch up to date',
    };
  if (sync.inProgress)
    return {
      tone: 'warn',
      text: `${capitalize(sync.inProgress)} unfinished`,
      title: 'Open the git panel to finish or abort it',
      act: 'resolve',
      fix: 'Finish',
    };
  if (sync.rewritten)
    return {
      tone: 'warn',
      text: 'Rebased, not pushed',
      title: 'Force-push to update the PR',
      act: 'push',
      fix: 'Force-push',
    };
  if (!status) return null;
  const reason = status.reason || '';
  const pills: Record<string, MergePill> = {
    clean: { tone: 'ok', text: 'Ready to merge', title: 'No conflicts with ' + base },
    unstable: {
      tone: 'warn',
      text: 'Checks failing',
      title: reason || 'Mergeable, but some checks are failing',
    },
    conflicts: {
      tone: 'err',
      text: 'Conflicts with ' + base,
      title: 'Resolve them with your coding harness',
      act: 'resolve',
      fix: 'Resolve conflicts',
    },
    behind: {
      tone: 'warn',
      text: 'Behind ' + base,
      title: 'Bring the branch up to date with your coding harness',
      act: 'resolve',
      fix: 'Update branch',
    },
    blocked: {
      tone: 'muted',
      text: 'Merge blocked',
      title: reason || 'Branch protection refuses the merge',
    },
    unknown: {
      tone: 'busy',
      text: 'Checking…',
      title: 'The forge is still computing whether this PR can merge',
    },
  };
  return pills[status.state] || null;
}

export const PILL_ICONS: Record<string, string> & { muted: string } = {
  err: 'icon-[lucide--triangle-alert]',
  warn: 'icon-[lucide--circle-alert]',
  busy: 'icon-[lucide--loader-circle] animate-spin',
  ok: 'icon-[lucide--circle-check]',
  muted: 'icon-[lucide--circle-dashed]',
};

export interface MergeMethod {
  label: string;
  button: string;
  confirm: string;
  done: string;
  explain: (count: number, base: string) => string;
}
export const MERGE_METHODS: Record<string, MergeMethod> = {
  merge: {
    label: 'Create a merge commit',
    button: 'Merge',
    confirm: 'Confirm merge',
    done: 'Merged',
    explain: (n: number, base: string): string =>
      `All ${pluralize(n, 'commit')} from this branch are added to ${base} with a merge commit.`,
  },
  squash: {
    label: 'Squash and merge',
    button: 'Squash and merge',
    confirm: 'Confirm squash and merge',
    done: 'Squashed and merged',
    explain: (n: number, base: string): string =>
      `The ${pluralize(n, 'commit')} from this branch are combined into one commit on ${base}.`,
  },
  rebase: {
    label: 'Rebase and merge',
    button: 'Rebase and merge',
    confirm: 'Confirm rebase and merge',
    done: 'Rebased and merged',
    explain: (n: number, base: string): string =>
      `The ${pluralize(n, 'commit')} from this branch are replayed onto ${base} one by one, with no merge commit.`,
  },
};

/** The remembered method when the forge allows it, otherwise squash or the first allowed. */
export function chosenMethod(allowed: string[], remembered: string): string {
  if (allowed.includes(remembered)) return remembered;
  if (allowed.includes('squash')) return 'squash';
  return allowed[0] || 'merge';
}

/** What makes merging now wrong (blocks Confirm) and what is merely worth knowing. */
export function mergeWarnings(
  info: Partial<MergeInfo>,
  sync: SyncContext,
  base: string,
): { block: string; notes: string[] } {
  const state = info?.status?.state || '';
  let block = '';
  if (sync.running || sync.inProgress)
    block = 'A rebase is in progress in this checkout. Finish or abort it first.';
  else if (info.rewritten || sync.rewritten)
    block =
      'This checkout was rebased but not pushed. Force-push it first, or the old commits are what merges.';
  else if (info.stale)
    block = 'The PR has commits this checkout has not seen. Pull and review them before merging.';
  else if (state === 'conflicts') block = `This PR has conflicts with ${base}. Resolve them first.`;
  const notes = [];
  if (state === 'unstable')
    notes.push(info.status?.reason || 'Some checks are failing or still running.');
  if ((info.unpushed || 0) > 0 && !info.rewritten)
    notes.push(
      `${pluralize(info.unpushed || 0, 'local commit')} in this checkout ${info.unpushed === 1 ? "isn't" : "aren't"} pushed to the PR and won't be part of the merge.`,
    );
  return { block, notes };
}

/** First line is the commit title; the rest, past the blank line, its body. */
export function splitMessage(text: string): { title: string; message: string } {
  let message = (text || '').trim();
  const fence =
    message.match(/```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n```/) ||
    message.match(/^```([\s\S]*?)```$/);
  if (fence) message = (fence[1] || '').trim();
  const quoted =
    (message.startsWith('"') && message.endsWith('"')) ||
    (message.startsWith("'") && message.endsWith("'"));
  if (quoted) message = message.slice(1, -1).trim();
  const [title, ...rest] = message.split('\n');
  return { title: (title || '').trim(), message: rest.join('\n').trim() };
}

export const FORGE_SOURCES: Record<string, string> = {
  settings: 'a token saved in faah Settings',
  env: 'an environment variable',
  gh: 'the GitHub CLI (gh)',
  glab: 'the GitLab CLI (glab)',
  session: 'a token used for this session only',
};

/** The connected toast: which scope the token got and whether it can approve and merge. */
export function connectedMessage(label: string, reply: Partial<ForgeReply>): string {
  let message = `Connected to ${label}`;
  if (!reply.saved) message += ' for this session (a token for another host is already saved)';
  if (reply.validated && !reply.writeAccess)
    message += '. Read access only: Approve and Merge need push access to this repository';
  return message;
}

export function mergeMethodInfo(method: string): MergeMethod {
  const info = MERGE_METHODS[method];
  if (!info) throw new Error('Unknown merge method: ' + method);
  return info;
}
