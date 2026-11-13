import { decodePRMeta, decodeForge } from '../pr/decode.ts';
import { decodeHarnesses } from '../agents/decode.ts';
import {
  record,
  text,
  number,
  boolean,
  list,
  strings,
  stringMap,
  booleanMap,
} from '../lib/decode.ts';
import type { WorkspaceMeta } from '../app/types.ts';
export interface TreeEntry {
  path: string;
  name: string;
  dir?: boolean;
  size?: number;
  ignored?: boolean;
  status?: string;
  staged?: boolean;
  partial?: boolean;
  dirty?: boolean;
  yourStatus?: string;
  yourDirty?: boolean;
}
export interface TreeRow extends TreeEntry {
  depth: number;
}
export interface GitCommit {
  full: string;
  hash: string;
  subject: string;
  author: string;
  date: string;
}
export interface GitSnapshot {
  git?: boolean;
  gitChanges?: number;
  gitFiles?: string[];
  statuses?: Record<string, string>;
  dirtyDirs?: Record<string, boolean>;
  staged?: Record<string, boolean>;
  partial?: Record<string, boolean>;
  yourStatuses?: Record<string, string>;
  yourDirtyDirs?: Record<string, boolean>;
  branch?: string;
  recentCommits?: GitCommit[];
  commitsUrl?: string;
  ahead?: number;
  behind?: number;
  rewritten?: boolean;
}
export interface Metrics {
  rssBytes: number;
  peakRssBytes?: number;
  cpuUsage: number;
  goroutines: number;
  lspEnabled: boolean;
  lspMemBytes: number;
}
export function decodeTree(value: unknown): { children: TreeEntry[] } {
  return {
    children: list(record(value).children).map((item) => {
      const row = record(item);
      return {
        path: text(row.path),
        name: text(row.name),
        dir: boolean(row.dir),
        size: number(row.size),
        ignored: boolean(row.ignored),
        status: text(row.status),
        staged: boolean(row.staged),
        partial: boolean(row.partial),
        dirty: boolean(row.dirty),
        yourStatus: text(row.yourStatus),
        yourDirty: boolean(row.yourDirty),
      };
    }),
  };
}
export function decodeCommit(value: unknown): GitCommit {
  const row = record(value);
  return {
    full: text(row.full),
    hash: text(row.hash),
    subject: text(row.subject),
    author: text(row.author),
    date: text(row.date),
  };
}
export function decodeGitSnapshot(value: unknown): GitSnapshot {
  const row = record(value);
  return {
    ...row,
    git: boolean(row.git),
    gitChanges: row.gitChanges === undefined ? undefined : number(row.gitChanges),
    gitFiles: strings(row.gitFiles),
    statuses: stringMap(row.statuses),
    dirtyDirs: booleanMap(row.dirtyDirs),
    staged: booleanMap(row.staged),
    partial: booleanMap(row.partial),
    yourStatuses: stringMap(row.yourStatuses),
    yourDirtyDirs: booleanMap(row.yourDirtyDirs),
    branch: text(row.branch),
    recentCommits:
      row.recentCommits === undefined ? undefined : list(row.recentCommits).map(decodeCommit),
    commitsUrl: text(row.commitsUrl),
    ahead: number(row.ahead),
    behind: number(row.behind),
    rewritten: boolean(row.rewritten),
  };
}
export function decodeMetrics(value: unknown): Metrics {
  const row = record(value);
  return {
    rssBytes: number(row.rssBytes),
    peakRssBytes: number(row.peakRssBytes),
    cpuUsage: number(row.cpuUsage),
    goroutines: number(row.goroutines),
    lspEnabled: boolean(row.lspEnabled),
    lspMemBytes: number(row.lspMemBytes),
  };
}
export function decodeMeta(value: unknown): WorkspaceMeta {
  const row = record(value);
  return {
    ...row,
    root: text(row.root),
    name: text(row.name),
    version: text(row.version),
    workbench: text(row.workbench),
    files: number(row.files),
    indexMs: number(row.indexMs),
    git: boolean(row.git),
    gitChanges: number(row.gitChanges),
    gitFiles: strings(row.gitFiles),
    ready: boolean(row.ready),
    threadsEnabled: boolean(row.threadsEnabled),
    metrics: row.metrics === undefined ? undefined : decodeMetrics(row.metrics),
    forge: row.forge ? decodeForge(row.forge) : undefined,
    pr: row.pr ? decodePRMeta(row.pr) : undefined,
    agents: decodeHarnesses(row.agents),
    agentEnabled: row.agentEnabled === undefined ? undefined : boolean(row.agentEnabled),
    agent: text(row.agent),
    agentModel: text(row.agentModel),
    agentPinned: boolean(row.agentPinned),
  };
}
export function decodeReindex(value: unknown): {
  files: number;
  indexMs: number;
  gitChanges: number;
  gitFiles: string[];
} {
  const row = record(value);
  return {
    files: number(row.files),
    indexMs: number(row.indexMs),
    gitChanges: number(row.gitChanges),
    gitFiles: strings(row.gitFiles),
  };
}
export function decodeNewItem(value: unknown): { path: string } {
  return { path: text(record(value).path) };
}
