import type { Diagnostic, LspBrief, SymbolInfo } from './decode.ts';
import type { Position } from './cursor.ts';
export interface ImageState {
  fit: boolean;
  scale: number;
  panX: number;
  panY: number;
  bg: string;
  pixelated: boolean | null;
}
export interface DocTab {
  path: string;
  name: string;
  lang: string;
  total: number;
  maxCols: number;
  size: number;
  cur: number;
  col: number;
  scrollTop: number;
  dirty: boolean;
  isEditing: boolean;
  isImage: boolean;
  deleted: boolean;
  lsp: LspBrief;
  diagnostics: Diagnostic[];
  view: string;
  image: ImageState;
  imageMeta?: { width: number; height: number };
  mdLine?: number;
  mdScroll?: number;
  mdAnchor?: string;
  diffScroll?: number;
  prCollapsed?: boolean;
  youCollapsed?: boolean;
  diffScope?: string;
  viewerRevision: number;
  diffMode: string | null;
  diffAvailable: boolean;
  diffDismissed: boolean;
  openedInDiffView: boolean;
  diffRef: string;
  diffBase: string;
  turnFiles: { path: string; binary?: boolean }[] | null;
  turnLabel: string;
  outline: SymbolInfo[] | null;
  outlineSource?: string;
  gutter: { marks: Map<number, string>; dels: Set<number> } | null;
  gutterLoaded?: boolean;
  selAnchor: Position | null;
}
export interface OpenOptions {
  line?: number;
  col?: number;
  ref?: string;
  base?: string;
  layout?: string;
  view?: string;
  activate?: boolean;
  push?: boolean;
  soft?: boolean;
  turnFiles?: { path: string; binary?: boolean }[];
  turnLabel?: string;
}
