import { atoi } from './commands.ts';
import { splitFields } from './status-parser.ts';

export interface GitCommit {
  hash: string;
  full: string;
  subject: string;
  author: string;
  date: string;
}
export interface GitUnpushedCommit {
  hash: string;
  short: string;
  subject: string;
  author: string;
  date: string;
}
export interface CommitFile {
  path: string;
  status: string;
  from?: string;
  add: number;
  del: number;
  binary?: boolean;
}
export interface Numstat {
  add: number;
  del: number;
  binary: boolean;
}
export interface CommitDetail {
  hash: string;
  short: string;
  subject: string;
  message: string;
  author: string;
  email: string;
  date: string;
  dateIso: string;
  files: number;
  insertions: number;
  deletions: number;
  authorUrl?: string;
  commitUrl?: string;
}
export function recentCommit(line: string): GitCommit {
  const fields = line.split('\x1f');
  return {
    hash: fields[0] ?? '',
    subject: fields[1] ?? '',
    author: fields[2] ?? '',
    date: fields[3] ?? '',
    full: fields[4] ?? '',
  };
}
export function unpushedCommit(line: string): GitUnpushedCommit {
  const fields = line.split('\x1f');
  return {
    hash: fields[0] ?? '',
    short: fields[1] ?? '',
    subject: fields[2] ?? '',
    author: fields[3] ?? '',
    date: fields[4] ?? '',
  };
}
export class NumstatParser {
  readonly stats = new Map<string, Numstat>();
  private pending: Numstat | undefined;
  private original = false;
  record(value: string): void {
    if (this.pending) {
      if (this.original) {
        this.original = false;
        return;
      }
      this.stats.set(value, this.pending);
      this.pending = undefined;
      return;
    }
    const fields = splitFields(value, '\t', 3);
    if (fields.length !== 3) return;
    const add = fields[0] ?? '',
      del = fields[1] ?? '',
      path = fields[2] ?? '';
    const stat = { add: atoi(add) ?? 0, del: atoi(del) ?? 0, binary: add === '-' && del === '-' };
    if (path) this.stats.set(path, stat);
    else {
      this.pending = stat;
      this.original = true;
    }
  }
}
