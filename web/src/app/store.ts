import { createLayoutActions } from '../layout/actions.js';
import { readLayout } from '../layout/logic.js';
import { createWorkspaceActions } from '../workspace/actions.js';
import { createViewerActions } from '../viewers/actions.js';
import { createDocuments } from '../editor/documents.js';
import { createSettingsStore } from '../settings/store.ts';
import { batch, createMemo } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';

import type { DocTab } from '../editor/documents.js';
import type { OrbModel } from '../viewers/orb-model.js';
import type { WorkspaceMeta } from './types.ts';
import type { SettingsOptions } from '../settings/store.ts';
export interface AppState {
  layout: ReturnType<typeof readLayout>;
  workspace: {
    meta: WorkspaceMeta | null;
    generation: number;
    metrics: unknown;
    note: string;
    reindexing: boolean;
    connected: boolean;
    pending: boolean;
    error: string;
  };
  documents: {
    tabs: DocTab[];
    active: number;
    history: { path: string; line: number }[];
    historyIndex: number;
  };
  editor: { charWidth: number; lineHeight?: number };
  navigation: {
    find: unknown;
    occurrence: string | null;
    selection: unknown;
    hover: unknown;
    hoverAnchor: unknown;
    at: unknown;
    link: unknown;
    lastWord: string;
    reference?: { path: string; l1: number; l2: number };
  };
  lsp: {
    servers: unknown[];
    state: string;
    server: string;
    missing?: string;
    anyRunning?: boolean;
    enabled?: boolean;
    memBytes?: number;
  };
  git: { unpushedCount: number; snapshot: unknown; revision: number };
  viewers: { viewed: Record<string, boolean> };
  explanation: { model: OrbModel | null; shown: boolean };
}
// Navigation actions update only touched fields, preserving unrelated store subscriptions.
export type NavigationPatch = Partial<AppState['navigation']>;
export interface AppOptions {
  onActivate?: () => void;
  onClose?: () => void;
  settings?: SettingsOptions;
  fetcher?: (path: string, params: unknown, options?: RequestInit) => Promise<unknown>;
  request?: (path: string, params?: unknown, options?: RequestInit) => Promise<unknown>;
  post?: (path: string, params?: unknown, options?: RequestInit) => Promise<unknown>;
}
function initialState(): AppState {
  return {
    layout: readLayout(localStorage.getItem('faah.layout')),
    workspace: {
      meta: null,
      generation: 0,
      metrics: null,
      note: '',
      reindexing: false,
      connected: false,
      pending: false,
      error: '',
    },
    documents: { tabs: [], active: -1, history: [], historyIndex: -1 },
    editor: { charWidth: 7.8 },
    navigation: {
      find: null,
      occurrence: null,
      selection: null,
      hover: null,
      hoverAnchor: null,
      at: null,
      link: null,
      lastWord: '',
    },
    lsp: { servers: [], state: 'off', server: '' },
    git: { unpushedCount: 0, snapshot: null, revision: 0 },
    viewers: { viewed: {} },
    explanation: { model: null, shown: false },
  };
}

/** A fresh store belongs to one mounted app. */
export type AppStore = ReturnType<typeof buildAppStore>;
export function createAppStore(options: AppOptions = {}): AppStore {
  return buildAppStore(options);
}
function buildAppStore(options: AppOptions) {
  const [state, set] = createStore(initialState());
  // Settings are app-wide: editor preferences, theme and document defaults derive from them.
  const settings = createSettingsStore(options.settings);
  const documentOptions = { ...options, preferences: settings.preferences };
  const documents = createDocuments(state, set, documentOptions);
  const activeDocument = createMemo(() => state.documents.tabs[state.documents.active] || null);
  const store = {
    state,
    settings,
    activeDocument,
    buffers: documents.buffers,
    bufferRevision: documents.bufferRevision,
    actions: {
      ...documents,
      setViewed: (path: string, value: boolean): void => set('viewers', 'viewed', path, value),
      setExplanation: (model: OrbModel | null): void =>
        set('explanation', 'model', reconcile(model)),
      setExplanationShown: (shown: boolean): void => set('explanation', 'shown', shown),
      setNavigation: (patch: NavigationPatch): void => set('navigation', patch),
      setGeometry: (patch: { charWidth?: number; lineHeight?: number }): void =>
        set('editor', patch),
      setWorkspace: (meta: WorkspaceMeta): void =>
        batch(() => {
          set('workspace', 'meta', reconcile(meta));
          if (meta?.metrics) set('workspace', 'metrics', reconcile(meta.metrics));
        }),
      patchWorkspace: (name: keyof WorkspaceMeta, value: unknown): void =>
        set('workspace', 'meta', name, value),
      setUnpushedCount: (count: number): void => set('git', 'unpushedCount', count),
      acceptLspServers: (result: { servers?: unknown[]; anyRunning?: boolean }): void =>
        batch(() => {
          set('lsp', 'servers', reconcile(result.servers || [], { key: 'name' }));
          set('lsp', 'anyRunning', !!result.anyRunning);
        }),
      acceptLspReply: (
        reply: { state?: string; server?: string; missing?: string } | null,
        path: string | undefined = activeDocument()?.path,
      ): void => {
        if (!reply?.state) return;
        const brief = {
          state: reply.state,
          server: reply.server || '',
          missing: reply.missing || '',
        };
        if (path) store.actions.patchDocument(path, { lsp: brief });
        if (path === activeDocument()?.path) set('lsp', brief);
      },
      setLsp: (lsp: AppState['lsp']): void => set('lsp', reconcile(lsp)),
      patchLsp: (name: keyof AppState['lsp'], value: unknown): void => {
        if (
          (name === 'state' || name === 'server' || name === 'missing') &&
          typeof value === 'string'
        )
          set('lsp', name, value);
        else if ((name === 'anyRunning' || name === 'enabled') && typeof value === 'boolean')
          set('lsp', name, value);
        else if (name === 'memBytes' && typeof value === 'number') set('lsp', name, value);
        else if (name === 'servers' && Array.isArray(value)) set('lsp', name, value);
      },
    },
  };
  Object.assign(
    store.actions,
    createLayoutActions(store, set),
    createViewerActions(store),
    createWorkspaceActions(store, set, options),
  );
  return store;
}
