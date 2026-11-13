import { record, text, number, boolean, list, strings, stringMap } from '../lib/decode.ts';
import type {
  PRMeta,
  PRComment,
  Draft,
  MergeInfo,
  ForgeReply,
  ForgeMeta,
  MergeMessage,
} from './types.ts';
export function decodePRMeta(value: unknown): PRMeta {
  const v = record(value);
  return {
    number: number(v.number),
    title: text(v.title),
    author: text(v.author),
    base: text(v.base),
    head: text(v.head),
    state: text(v.state),
    merged: boolean(v.merged),
    mergedAt: text(v.mergedAt),
    draft: boolean(v.draft),
    writeAccess: boolean(v.writeAccess),
    readOnly: boolean(v.readOnly),
    draftCount: number(v.draftCount),
    diffBaseWarning: text(v.diffBaseWarning),
    headSHA: text(v.headSHA),
    url: text(v.url),
    files: stringMap(v.files),
  };
}
export function decodeDraft(value: unknown): Draft {
  const v = record(value);
  return {
    id: number(v.id),
    path: text(v.path),
    line: number(v.line),
    side: text(v.side),
    body: text(v.body),
  };
}
export function decodeDrafts(value: unknown): Draft[] {
  return list(record(value).comments).map(decodeDraft);
}
export function decodeComment(value: unknown): PRComment {
  const v = record(value);
  return {
    id: number(v.id),
    kind: text(v.kind),
    path: text(v.path),
    line: number(v.line),
    side: text(v.side),
    inReplyTo: number(v.inReplyTo),
    author: text(v.author),
    avatarUrl: text(v.avatarUrl),
    body: text(v.body),
    bodyHtml: text(v.bodyHtml),
    createdAt: text(v.createdAt),
    url: text(v.url),
  };
}
export function decodeComments(value: unknown): {
  issueComments: PRComment[];
  reviewComments: PRComment[];
} {
  const v = record(value);
  return {
    issueComments: list(v.issueComments).map(decodeComment),
    reviewComments: list(v.reviewComments).map(decodeComment),
  };
}
export function decodeMerge(value: unknown): MergeInfo {
  const v = record(value);
  const s = record(v.status);
  return {
    status: {
      state: text(s.state),
      reason: text(s.reason),
      methods: strings(s.methods),
      canMerge: boolean(s.canMerge),
      headSha: text(s.headSha),
    },
    canMerge: boolean(v.canMerge),
    stale: boolean(v.stale),
    rewritten: boolean(v.rewritten),
    inProgress: text(v.inProgress),
    unpushed: number(v.unpushed),
    base: text(v.base),
    hasInstruction: boolean(v.hasInstruction),
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
    defaults: Object.fromEntries(
      Object.entries(v.defaults ? record(v.defaults) : {}).map(([key, item]) => {
        const m = record(item);
        const message: MergeMessage = { title: text(m.title), message: text(m.message) };
        return [key, message];
      }),
    ),
  };
}
export function decodeForgeReply(value: unknown): ForgeReply {
  const v = record(value);
  return {
    saved: boolean(v.saved),
    validated: boolean(v.validated),
    writeAccess: boolean(v.writeAccess),
  };
}
export function decodeForge(value: unknown): ForgeMeta {
  const v = record(value);
  const i = record(v.info);
  const s = v.setup ? record(v.setup) : null;
  const e = s?.extra ? record(s.extra) : null;
  return {
    info: {
      name: text(i.name),
      label: text(i.label),
      tokenKey: text(i.tokenKey),
      tokenCategory: text(i.tokenCategory),
      tokenHint: text(i.tokenHint),
    },
    hasToken: boolean(v.hasToken),
    source: text(v.source),
    host: text(v.host),
    setup: s
      ? {
          url: text(s.url),
          steps: strings(s.steps),
          cli: text(s.cli),
          env: text(s.env),
          hostKey: text(s.hostKey),
          readonly: text(s.readonly),
          extra: e
            ? {
                key: text(e.key),
                label: text(e.label),
                placeholder: text(e.placeholder),
                hint: text(e.hint),
              }
            : undefined,
        }
      : undefined,
  };
}
export function decodeLaunch(value: unknown): { href: string } {
  const v = record(value);
  const error = text(v.error);
  if (error) throw new Error(error);
  return { href: text(v.href) };
}
