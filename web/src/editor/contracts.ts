import type { PanelName } from '../layout/logic.ts';
import type { Thread, ThreadSummary } from '../threads/decode.ts';
import type { EditTarget } from '../agents/logic.ts';
import type { AgentJob } from '../agents/job-decode.ts';
import type { AgentJobOptions } from '../agents/jobs.ts';
import type { SettingsMode } from '../settings/store.ts';
import type { Accessor } from 'solid-js';
import type { SetStoreFunction } from 'solid-js/store';
import type { AppStore } from '../app/store.ts';
import type { OpenOptions } from './types.ts';
import type { SearchFields } from '../search/logic.ts';
import type { SearchReply } from '../search/decode.ts';
import type { DocTab } from './types.ts';
import type { DocumentBuffer } from './buffer.ts';
import type { FindHit } from './find.ts';
import type { Position } from './cursor.ts';
import type { SelectionInfo } from './selection.ts';
import type { Point } from './hover.ts';
import type { HoverReply, Diagnostic, LspBrief } from './decode.ts';
import type { VimState } from './vim.ts';
export interface WordPosition {
  word: string;
  path: string;
  line: number;
  col: number;
  inDiff?: boolean;
  imprecise?: boolean;
}
export interface Geometry {
  width: number;
  height: number;
  top: number;
  charWidth: number;
  lineHeight: number;
}
export interface EditorUI {
  opening: string;
  error: string;
  findLoading: boolean;
  findError: string;
  editLoading: boolean;
  editError: string;
  hoverLoading: boolean;
  hoverError: string;
  findOpen: boolean;
  query: string;
  caseSensitive: boolean;
  hits: FindHit[];
  activeHit: number;
  selection: SelectionInfo | null;
  menu: { info: SelectionInfo; x: number; y: number } | null;
  hover: { at: WordPosition; data: HoverReply; diagnostics: Diagnostic[]; focus: boolean } | null;
  hoverPosition: Point | null;
  vimHelp: boolean;
  vim: VimState;
}
export interface Services {
  imageKey?: (event: KeyboardEvent) => boolean;
  diagramFullscreens?: Set<() => boolean>;
  selection?: { copied: (action: string) => void };
  source?: {
    scrollTo: (top: number) => void;
    topLine: () => number;
    clearSelection: () => void;
    select: (anchor: Position, head: Position) => void;
    focus: () => void;
    caretPoint: () => Point | null;
  };
  edit?: {
    center: (line: number, start?: number, end?: number) => void;
    selectedText: () => string;
    focus: () => void;
  };
  find?: { focus: () => void };
  preview?: {
    key: (event: KeyboardEvent) => boolean;
    select: () => void;
    find: (query: string, caseSensitive: boolean) => FindHit[];
    showHit: (index: number) => void;
    clearMarks: () => void;
    line: (line: number) => void;
    topLine: () => number;
  };
  diff?: {
    currentLine: () => number;
    scrollLine: (line: number) => void;
    stepHunk: (direction: number) => void;
  };
}
export interface CoreActions {
  setPanelVisible: (name: PanelName, visible: boolean) => void;
  setSelection: (info: SelectionInfo | null) => void;
  refreshTree: () => Promise<void>;
  reloadWorkspace: (target?: EditTarget | null) => Promise<void>;
  orbThread: (thread: Thread) => void;
  orbSummary: (summary: ThreadSummary) => void;
  orbStep: (id: string, text: string) => void;
  orbBegin: () => void;
  orbAttach: (thread: Thread) => void;
  orbFailed: (message: string) => void;
  loadThread: (id: string) => Promise<Thread>;
  acceptThread: (thread: Thread) => void;
  openForgeConnect: (reason?: string) => void;
  refreshMergeStatus: () => Promise<void>;
  runAgentJob: (endpoint: string, params: unknown, options?: AgentJobOptions) => Promise<AgentJob>;
  setReviewMode: (mode: string) => void;
  openSettings: (mode?: SettingsMode, category?: string, key?: string) => void;
  refreshPRMeta: () => Promise<void>;
  resolvePRBase: () => Promise<unknown>;
  confirmForcePush: () => void;
  executeFind: (delta?: number) => Promise<void>;
  patch: (patch: Partial<DocTab>) => void;
  refresh: () => void;
  centerLine: (line: number) => void;
  revealLine: (line: number) => void;
  activateView: () => void;
  syncSelection: () => void;
  clearSelection: () => void;
  clearFind: () => void;
  hideHover: () => void;
  centerEditLine: (line: number, start?: number, end?: number) => void;
  refreshWorkspace: () => Promise<void>;
  loadGutter: (path: string) => Promise<void>;
  findReferences: (at?: string | WordPosition) => void;
  gotoDefinition: (at?: WordPosition, options?: { view?: string }) => void;
  showCalls: (at?: WordPosition) => void;
  showHoverAtCaret: () => void;
  switchTab: (index: number) => void;
  openFind: (seed?: string, delta?: number) => void;
  jumpToHit: (index: number) => void;
  runSelectionAction: (action: string, info?: SelectionInfo | null) => boolean;
  openPalette: (mode: string, seed?: string) => void;
  pushHistory: (path: string, line: number) => void;
  openFile: (path: string, options?: OpenOptions) => Promise<void>;
  wordAtCaret: () => WordPosition | null;
  searchWorkspace: (query: string, patch?: Partial<SearchFields>) => void;
  setSearchResults: (reply: SearchReply) => void;
  showFilesPanel: () => Promise<void>;
  revealFile: (path: string) => Promise<void>;
  loadSymbols: () => Promise<unknown>;
  launchPR: (target: string) => unknown;
  reloadOpenTabs: (options?: { onlyIfChanged: boolean }) => Promise<void>;
  reconcileTreeSnapshot: () => Promise<void>;
  closeTabs: (indices: number[]) => void;
  setDiffMode: (doc: DocTab | null, mode: string) => void;
  stepDiffFile: (doc: DocTab, file: { path: string }) => Promise<void>;
  acceptLspReply: (reply: LspBrief) => void;
}
export interface EditorHost {
  tree: { scope: () => string; autoReveal: () => boolean };
  git: { state: { pending: string; sync: { inProgress?: string; rewritten?: boolean } } };
  active: Accessor<DocTab | null>;
  buffer: Accessor<DocumentBuffer | undefined>;
  store: AppStore;
  settings: AppStore['settings'];
  ui: EditorUI;
  setUI: SetStoreFunction<EditorUI>;
  geometry: Geometry;
  offsets: () => Float64Array;
  services: Services;
  handlers: {
    prepare?: (info: SelectionInfo) => void;
    agent?: (info: SelectionInfo) => void;
    thread?: (info: SelectionInfo) => void;
    review?: (info: SelectionInfo) => void;
    explain?: (info: SelectionInfo) => void;
  };
  actions: CoreActions;
}
