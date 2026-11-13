import { record, text, number, boolean, list } from '../lib/decode.ts';
export interface DirectoryEntry {
  name: string;
  path: string;
  git?: boolean;
}
export interface Directory {
  path: string;
  parent: string;
  git?: boolean;
  entries: DirectoryEntry[];
}
export interface RecentItem {
  id: string;
  kind?: string;
  path: string;
  url?: string;
  title?: string;
  repo?: string;
  number?: number;
  pinned?: boolean;
  lastOpened?: number;
  state: string;
  error?: string;
  progress?: string;
  href: string;
}
export interface WorkbenchReply {
  items?: RecentItem[];
  cwd?: string;
  home?: string;
  sep?: string;
  version?: string;
}
export type OpenReply =
  | { needClone: true; repo: string; managed: string }
  | { needClone: false; id: string; href: string };
export function decodeItems(value: unknown): RecentItem[] {
  return list(value).map((item) => {
    const v = record(item);
    return {
      id: text(v.id),
      kind: text(v.kind),
      path: text(v.path),
      url: text(v.url),
      title: text(v.title),
      repo: text(v.repo),
      number: number(v.number),
      pinned: boolean(v.pinned),
      lastOpened: number(v.lastOpened),
      state: text(v.state),
      error: text(v.error),
      progress: text(v.progress),
      href: text(v.href),
    };
  });
}
export function decodeWorkbench(value: unknown): WorkbenchReply {
  const v = record(value);
  return {
    items: v.items === undefined ? undefined : decodeItems(v.items),
    cwd: v.cwd === undefined ? undefined : text(v.cwd),
    home: v.home === undefined ? undefined : text(v.home),
    sep: v.sep === undefined ? undefined : text(v.sep),
    version: v.version === undefined ? undefined : text(v.version),
  };
}
export function decodeDirectory(value: unknown): Directory {
  const v = record(value);
  return {
    path: text(v.path),
    parent: text(v.parent),
    git: boolean(v.git),
    entries: list(v.entries).map((item) => {
      const e = record(item);
      return { name: text(e.name), path: text(e.path), git: boolean(e.git) };
    }),
  };
}
export function decodeOpen(value: unknown): OpenReply {
  const v = record(value);
  if (boolean(v.needClone))
    return { needClone: true, repo: text(v.repo), managed: text(v.managed) };
  return { needClone: false, id: text(v.id), href: text(v.href) };
}
export function decodeMkdir(value: unknown): { path: string } {
  return { path: text(record(value).path) };
}
