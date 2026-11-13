/** What /api/meta says about the open workspace. The app store keeps it as received. */
export interface WorkspaceMeta {
  /** Absolute root path. */
  root: string;
  name: string;
  version?: string;
  /** The workbench page that opened this workspace, linked from the top bar. */
  workbench?: string;
  files?: number;
  indexMs?: number;
  git?: boolean;
  gitChanges?: number;
  gitFiles?: string[];
  /** False until the background indexer finishes. */
  ready?: boolean;
  threadsEnabled?: boolean;
  metrics?: unknown;
  pr?: unknown;
  forge?: {
    info: {
      name: string;
      label: string;
      tokenKey: string;
      tokenCategory: string;
      tokenHint: string;
    };
    hasToken: boolean;
  } | null;
  agents?: unknown;
  agent?: string;
  agentModel?: string;
  agentPinned?: boolean;
}

/** The language server state shown for the active file. */
export interface LSPState {
  servers?: string[];
  state: 'off' | 'starting' | 'ready' | 'missing';
  server: string;
  missing?: string;
}
