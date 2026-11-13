import type { DocTab } from '../editor/types.ts';
import type { Diagnostic } from '../editor/decode.ts';
import type { DiffHunk } from './diff-parse.ts';
import type { createDiffActions } from './diff-actions.ts';
export type RowLocator = (line: number) => number | null;
export interface DiffScrollProps {
  document: DocTab;
  registerRows?: (locate: RowLocator) => () => void;
  top: number;
  height: number;
  scrollTo: (top: number) => void;
  scrollLine: (line: number) => void;
  stepHunk: (direction: number) => void;
}
export interface DiffRowsProps {
  document: DocTab;
  diagnostics: Map<number, Diagnostic>;
  reviewable?: boolean;
  registerRows?: (locate: RowLocator) => () => void;
  top: number;
  height: number;
  jump: (line: number) => void;
  hunk: DiffHunk;
  mode: string;
}
export interface DiffSectionProps {
  document: DocTab;
  diagnostics: Map<number, Diagnostic>;
  reviewable?: boolean;
  registerRows?: (locate: RowLocator) => () => void;
  top: number;
  height: number;
  jump: (line: number) => void;
  hunks: DiffHunk[];
  kind: 'pr' | 'you' | 'commit';
  expanded: Map<DiffHunk, DiffHunk>;
  actions: ReturnType<typeof createDiffActions>;
  title: string;
  subtitle: string;
  bare?: boolean;
  canAct?: boolean;
  defaultCollapsed?: boolean;
}
