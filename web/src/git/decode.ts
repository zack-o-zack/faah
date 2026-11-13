import { record, text, number, boolean, list } from '../lib/decode.ts';
import { decodeCommit } from '../workspace/decode.ts';
import type { GitCommit } from '../workspace/decode.ts';
export interface UnpushedCommit {
  hash: string;
  short: string;
  subject: string;
  author: string;
  date: string;
}
export interface CommitFile {
  path: string;
  status: string;
  from: string;
  add: number;
  del: number;
  binary: boolean;
}
export interface SyncState {
  code?: string;
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  inProgress?: string;
  dirty?: boolean;
  pr?: number;
  rewritten?: boolean;
}
export function decodeSync(value: unknown): SyncState {
  const v = record(value);
  return {
    code: text(v.code),
    branch: text(v.branch),
    upstream: text(v.upstream),
    ahead: number(v.ahead),
    behind: number(v.behind),
    inProgress: text(v.inProgress),
    dirty: boolean(v.dirty),
    pr: number(v.pr),
    rewritten: boolean(v.rewritten),
  };
}
export function decodeUnpushed(value: unknown): { upstream: string; commits: UnpushedCommit[] } {
  const v = record(value);
  return {
    upstream: text(v.upstream),
    commits: list(v.commits).map((item) => {
      const c = record(item);
      return {
        hash: text(c.hash),
        short: text(c.short),
        subject: text(c.subject),
        author: text(c.author),
        date: text(c.date),
      };
    }),
  };
}
export function decodeLog(value: unknown): { commits: GitCommit[]; commitsUrl: string } {
  const v = record(value);
  return { commits: list(v.commits).map(decodeCommit), commitsUrl: text(v.commitsUrl) };
}
export function decodeCommitFiles(value: unknown): { files: CommitFile[] } {
  const v = record(value);
  return {
    files: list(v.files).map((item) => {
      const f = record(item);
      return {
        path: text(f.path),
        status: text(f.status),
        from: text(f.from),
        add: number(f.add),
        del: number(f.del),
        binary: boolean(f.binary),
      };
    }),
  };
}
export function decodeGutter(value: unknown): {
  available: boolean;
  added: number[];
  modified: number[];
  deleted: number[];
} {
  const v = record(value);
  return {
    available: boolean(v.available),
    added: list(v.added).map((item) => number(item)),
    modified: list(v.modified).map((item) => number(item)),
    deleted: list(v.deleted).map((item) => number(item)),
  };
}
export function decodeSyncError(error: unknown): SyncState | null {
  if (!(error instanceof Error) || !('body' in error)) return null;
  return decodeSync(error.body);
}
