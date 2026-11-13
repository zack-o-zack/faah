import { record, text, number, boolean, list } from '../lib/decode.ts';
import { decodeHunks } from '../viewers/decode.ts';
import type {
  StageDef,
  StageState,
  ReviewRun,
  WorkflowReply,
  ReviewEvent,
  Insight,
  WalkthroughReply,
} from './types.ts';
export function decodeStageDef(value: unknown): StageDef {
  const v = record(value);
  return {
    id: text(v.id),
    title: text(v.title),
    question: text(v.question),
    prompt: text(v.prompt),
    passPreviousContext: boolean(v.passPreviousContext),
    harness: text(v.harness),
    model: text(v.model),
  };
}
export function decodeStage(value: unknown): StageState {
  const v = record(value);
  return {
    def: decodeStageDef(v.def),
    status: text(v.status),
    threadId: text(v.threadId),
    error: text(v.error),
    started: number(v.started),
    finished: number(v.finished),
  };
}
export function decodeRun(value: unknown): ReviewRun {
  const v = record(value);
  return {
    id: text(v.id),
    workflowId: text(v.workflowId),
    status: text(v.status),
    activeStage: number(v.activeStage),
    stages: list(v.stages).map(decodeStage),
    created: number(v.created),
    updated: number(v.updated),
  };
}
export function decodeReviewEvent(value: unknown): ReviewEvent | null {
  if (value == null) return null;
  const v = record(value);
  if (Array.isArray(v.stages)) return decodeRun(v);
  if (v.def) return decodeStage(v);
  return {
    runId: text(v.runId),
    stageIndex: v.stageIndex === undefined ? undefined : number(v.stageIndex),
    stage: v.stage ? decodeStage(v.stage) : undefined,
  };
}
export function decodeConfig(value: unknown): WorkflowReply {
  const v = record(value);
  return {
    name: text(v.name),
    stages: list(v.stages).map(decodeStageDef),
    activeId: text(v.activeId),
    workflows: list(v.workflows).map((item) => {
      const w = record(item);
      return { id: text(w.id), name: text(w.name), stages: list(w.stages).map(decodeStageDef) };
    }),
  };
}
export function decodeReviewStatus(value: unknown): { config?: WorkflowReply; run?: ReviewRun } {
  const v = record(value);
  return {
    config: v.config ? decodeConfig(v.config) : undefined,
    run: v.run ? decodeRun(v.run) : undefined,
  };
}
function decodeInsights(value: unknown): Insight[] {
  return list(value).map((item) => {
    const i = record(item);
    return {
      line: number(i.line),
      endLine: number(i.endLine),
      kind: text(i.kind),
      text: text(i.text),
      explanation: text(i.explanation),
    };
  });
}
export function decodeWalkthrough(value: unknown): WalkthroughReply {
  const v = record(value);
  return {
    files: list(v.files).map((item) => {
      const f = record(item);
      const u = f.understanding ? record(f.understanding) : null;
      return {
        path: text(f.path),
        status: text(f.status),
        additions: number(f.additions),
        deletions: number(f.deletions),
        diff: text(f.diff),
        hunks: decodeHunks(f.hunks),
        understanding: u
          ? {
              summary: text(u.summary),
              fastReturns: decodeInsights(u.fastReturns),
              edgeCases: decodeInsights(u.edgeCases),
              coreLogic: decodeInsights(u.coreLogic),
            }
          : null,
      };
    }),
    totalFiles: number(v.totalFiles),
    totalAdditions: number(v.totalAdditions),
    totalDeletions: number(v.totalDeletions),
    baseRef: text(v.baseRef),
    headRef: text(v.headRef),
    prMode: boolean(v.prMode),
  };
}
