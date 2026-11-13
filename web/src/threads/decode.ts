import { record, text, number, boolean, list, strings } from '../lib/decode.ts';
export interface Evidence {
  source: string;
  definition?: boolean;
  refs?: number;
  refFiles?: number;
  callers?: number;
  identifiers?: number;
}
export interface Citation {
  line?: number;
  end?: number;
  path?: string;
  kind?: string;
}
export interface ExplainTarget {
  path: string;
  l1: number;
  l2: number;
  c1?: number;
  c2?: number;
  text: string;
}
export interface Note {
  kind: string;
  path: string;
  l1: number;
  l2: number;
  symbol: string;
  summary: string;
  detail: string;
  text: string;
  refs: string;
}
export interface Walkthrough {
  title: string;
  steps: { path: string; l1: number; l2: number; title: string; body: string; text: string }[];
}
export interface ThreadTurn {
  id: number;
  prompt?: string;
  reply?: string;
  reasoning?: string;
  tools?: string[];
  changed?: string[];
  beforeSha?: string;
  afterSha?: string;
  reverted?: boolean;
  tracked?: boolean;
  error?: string;
  running?: boolean;
  harness?: string;
  model?: string;
  started?: number;
  ms?: number;
  firstMs?: number;
  refs?: Record<string, Citation>;
  notes?: Note[];
  walkthroughs?: Walkthrough[];
}
export interface Thread {
  id: string;
  title?: string;
  kind?: string;
  path?: string;
  l1?: number;
  l2?: number;
  snippet?: string;
  scope?: string;
  scopeSent?: string;
  created?: number;
  updated?: number;
  sessionId?: string;
  turns: ThreadTurn[];
  explainKey?: string;
  explainKind?: string;
  explainReader?: string;
  evidenceHash?: string;
  evidence?: Evidence;
  explainReq?: ExplainTarget;
}
export interface ThreadSummary {
  id: string;
  title?: string;
  kind?: string;
  path?: string;
  l1?: number;
  l2?: number;
  updated?: number;
  turns?: number;
  running?: boolean;
  failed?: boolean;
  touched?: boolean;
}
export function decodeEvidence(value: unknown): Evidence {
  const v = record(value);
  return {
    source: text(v.source),
    definition: boolean(v.definition),
    refs: number(v.refs),
    refFiles: number(v.refFiles),
    callers: number(v.callers),
    identifiers: number(v.identifiers),
  };
}
function decodeCitations(value: unknown): Record<string, Citation> {
  return Object.fromEntries(
    Object.entries(record(value)).map(([key, item]) => {
      const r = record(item);
      return [
        key,
        { line: number(r.line), end: number(r.end), path: text(r.path), kind: text(r.kind) },
      ];
    }),
  );
}
export function decodeTurn(value: unknown): ThreadTurn {
  const v = record(value);
  return {
    id: number(v.id),
    prompt: text(v.prompt),
    reply: text(v.reply),
    reasoning: text(v.reasoning),
    tools: strings(v.tools),
    changed: strings(v.changed),
    beforeSha: text(v.beforeSha),
    afterSha: text(v.afterSha),
    reverted: boolean(v.reverted),
    tracked: v.tracked === undefined ? undefined : boolean(v.tracked),
    error: text(v.error),
    running: boolean(v.running),
    harness: text(v.harness),
    model: text(v.model),
    started: number(v.started),
    ms: number(v.ms),
    firstMs: number(v.firstMs),
    refs: v.refs ? decodeCitations(v.refs) : undefined,
    notes: list(v.notes).map((item) => {
      const n = record(item);
      return {
        path: text(n.path),
        l1: number(n.l1),
        l2: number(n.l2),
        symbol: text(n.symbol),
        summary: text(n.summary),
        detail: text(n.detail),
        refs: text(n.refs),
        text: text(n.text),
        kind: text(n.kind),
      };
    }),
    walkthroughs: list(v.walkthroughs).map((item) => {
      const w = record(item);
      return {
        title: text(w.title),
        steps: list(w.steps).map((item) => {
          const s = record(item);
          return {
            path: text(s.path),
            l1: number(s.l1),
            l2: number(s.l2),
            title: text(s.title),
            body: text(s.body),
            text: text(s.text),
          };
        }),
      };
    }),
  };
}
export function decodeThread(value: unknown): Thread {
  const v = record(value);
  return {
    id: text(v.id),
    title: text(v.title),
    kind: text(v.kind),
    path: text(v.path),
    l1: number(v.l1),
    l2: number(v.l2),
    snippet: text(v.snippet),
    scope: text(v.scope),
    scopeSent: text(v.scopeSent),
    created: number(v.created),
    updated: number(v.updated),
    sessionId: text(v.sessionId),
    turns: list(v.turns).map(decodeTurn),
    explainKey: text(v.explainKey),
    explainKind: text(v.explainKind),
    explainReader: text(v.explainReader),
    evidenceHash: text(v.evidenceHash),
    evidence: v.evidence ? decodeEvidence(v.evidence) : undefined,
    explainReq: v.explainReq ? decodeExplainTarget(v.explainReq) : undefined,
  };
}
export function decodeSummary(value: unknown): ThreadSummary {
  const v = record(value);
  return {
    id: text(v.id),
    title: text(v.title),
    kind: text(v.kind),
    path: text(v.path),
    l1: number(v.l1),
    l2: number(v.l2),
    updated: number(v.updated),
    turns: number(v.turns),
    running: boolean(v.running),
    failed: boolean(v.failed),
    touched: boolean(v.touched),
  };
}
export function decodeThreads(value: unknown): ThreadSummary[] {
  return list(record(value).threads).map(decodeSummary);
}
export function decodeThreadList(value: unknown): ThreadSummary[] {
  return list(value).map(decodeSummary);
}
export function decodeThreadEvent(value: unknown): {
  id: string;
  data: { turn: number; text: string };
} {
  const v = record(value);
  const d = record(v.data);
  return { id: text(v.id), data: { turn: number(d.turn), text: text(d.text) } };
}
export function decodeExplain(value: unknown): {
  thread: Thread;
  stale: boolean;
  staleReason: string;
} {
  const v = record(value);
  return {
    thread: decodeThread(v.thread),
    stale: boolean(v.stale),
    staleReason: text(v.staleReason),
  };
}

function decodeExplainTarget(value: unknown): ExplainTarget {
  const v = record(value);
  return {
    path: text(v.path),
    l1: number(v.l1),
    l2: number(v.l2),
    c1: v.c1 == null ? undefined : number(v.c1),
    c2: v.c2 == null ? undefined : number(v.c2),
    text: text(v.text),
  };
}
