import type { PRMeta, ForgeMeta } from '../pr/types.ts';
import type { Harness } from '../agents/decode.ts';
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
  pr?: PRMeta;
  forge?: ForgeMeta | null;
  agentEnabled?: boolean;
  agents?: Harness[];
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
