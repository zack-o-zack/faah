import { record, text, number, boolean, strings, list } from '../lib/decode.ts';
export interface AgentJob {
  id: number;
  harness: string;
  path: string;
  lines: string;
  running: boolean;
  error: string;
  log: string;
  stdout: string;
  stderr: string;
  changed: string[];
  ms: number;
  tracked: boolean;
  threadId: string;
  batchCount: number;
  items: { path: string; l1: number; l2: number; comment: string }[];
}
export function decodeAgentJob(value: unknown): AgentJob {
  const v = record(value);
  return {
    id: number(v.id),
    harness: text(v.harness),
    path: text(v.path),
    lines: text(v.lines),
    running: boolean(v.running),
    error: text(v.error),
    log: text(v.log),
    stdout: text(v.stdout),
    stderr: text(v.stderr),
    changed: strings(v.changed),
    ms: number(v.ms),
    tracked: boolean(v.tracked),
    threadId: text(v.threadId),
    batchCount: number(v.batchCount),
    items: list(v.items).map((item) => {
      const i = record(item);
      return { path: text(i.path), l1: number(i.l1), l2: number(i.l2), comment: text(i.comment) };
    }),
  };
}
