export interface PRMeta {
  number?: number;
  title?: string;
  author?: string;
  base?: string;
  head?: string;
  state?: string;
  merged?: boolean;
  mergedAt?: string;
  draft?: boolean;
  writeAccess?: boolean;
  readOnly?: boolean;
  draftCount?: number;
  diffBaseWarning?: string;
  headSHA?: string;
  url?: string;
  files?: Record<string, string>;
}
export interface PRComment {
  id: number;
  kind?: string;
  path?: string;
  line?: number;
  side?: string;
  inReplyTo?: number;
  author?: string;
  avatarUrl?: string;
  body?: string;
  bodyHtml?: string;
  createdAt?: string;
  url?: string;
}
export interface Draft {
  id: number;
  path: string;
  line: number;
  side?: string;
  body: string;
}
export interface Composer {
  id: string;
  path: string;
  line: number;
  side: string;
  label: string;
  body: string;
  pending: boolean;
  error: string;
}
export interface CommentThread {
  key: string;
  path: string;
  side: string;
  line: number;
  existing: PRComment[];
  drafts: Partial<Draft>[];
  root?: PRComment | null;
}
export interface MergeStatus {
  state: string;
  reason?: string;
  methods?: string[];
  canMerge?: boolean;
  headSha?: string;
}
export interface MergeMessage {
  title: string;
  message: string;
}
export interface MergeInfo {
  status: MergeStatus;
  canMerge?: boolean;
  stale?: boolean;
  rewritten?: boolean;
  inProgress?: string;
  unpushed?: number;
  defaults?: Record<string, MergeMessage>;
  commits?: { hash: string; short?: string; subject: string; author?: string; date?: string }[];
  base?: string;
  hasInstruction?: boolean;
}
export interface SyncContext {
  running?: boolean;
  inProgress?: string;
  rewritten?: boolean;
}
export interface MergePill {
  tone: string;
  text: string;
  title: string;
  act?: string;
  fix?: string;
}
export interface ForgeReply {
  saved: boolean;
  validated: boolean;
  writeAccess: boolean;
}
export interface ForgeInfo {
  name?: string;
  label: string;
  tokenKey?: string;
  tokenCategory?: string;
  tokenHint?: string;
}
export interface ForgeMeta {
  info: ForgeInfo;
  hasToken?: boolean;
  source?: string;
  host?: string;
  setup?: {
    url: string;
    steps: string[];
    cli: string;
    env: string;
    hostKey: string;
    extra?: { key: string; label: string; placeholder: string; hint: string };
    readonly: string;
  };
}
