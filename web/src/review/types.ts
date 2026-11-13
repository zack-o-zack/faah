import type { DiffHunk } from '../viewers/diff-parse.ts';
export interface StageDraft {
  id?: string;
  title: string;
  question: string;
  prompt: string;
  passPreviousContext?: boolean;
  harness?: string;
  model?: string;
}
export interface StageDef extends StageDraft {
  id: string;
}
export interface StageState {
  def: StageDef;
  status: string;
  threadId?: string;
  error?: string;
  started?: number;
  finished?: number;
}
export interface ReviewRun {
  id: string;
  workflowId?: string;
  status: string;
  activeStage: number;
  stages: StageState[];
  created?: number;
  updated?: number;
}
export interface ReviewConfig {
  name: string;
  stages: StageDef[];
}
export interface WorkflowReply {
  name?: string;
  stages?: StageDef[];
  activeId?: string;
  workflows?: { id: string; name: string; stages: StageDef[] }[];
}
export type ReviewEvent =
  ReviewRun | { runId?: string; stageIndex?: number; stage?: StageState } | StageState;
export interface Insight {
  line: number;
  endLine?: number;
  kind: string;
  text: string;
  explanation: string;
}
export interface Understanding {
  summary?: string;
  fastReturns?: Insight[];
  edgeCases?: Insight[];
  coreLogic?: Insight[];
}
export interface WalkthroughFile {
  path: string;
  status?: string;
  additions?: number;
  deletions?: number;
  diff?: string;
  hunks?: DiffHunk[];
  understanding?: Understanding | null;
}
export interface WalkthroughReply {
  files: WalkthroughFile[];
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
  baseRef: string;
  headRef: string;
  prMode: boolean;
}
