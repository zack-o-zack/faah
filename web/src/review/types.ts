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
export type FileGroup = 'core' | 'tests' | 'config' | 'docs' | 'generated';
export interface WalkthroughFile {
  path: string;
  status?: string;
  additions?: number;
  deletions?: number;
  diff?: string;
  hunks?: DiffHunk[];
  group: FileGroup;
  oldPath?: string;
}
export interface WalkthroughReply {
  hiddenWhitespaceFiles: number;
  files: WalkthroughFile[];
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
  baseRef: string;
  headRef: string;
  prMode: boolean;
}

export interface ReviewBases {
  current: string;
  defaultRemote: string;
  upstream: string;
  branches: { name: string; remote: boolean }[];
}
