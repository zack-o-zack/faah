import { createLayoutActions } from '../layout/actions.js';
import { readLayout } from '../layout/logic.js';
import { createWorkspaceActions } from '../workspace/actions.js';
import { createViewerActions } from '../viewers/actions.js';
import { createDocuments } from '../editor/documents.js';
import { batch, createMemo } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';

/** @typedef {import('../editor/documents.js').DocTab} DocTab */
/** @typedef {import('../state.js').WorkspaceMeta} WorkspaceMeta */
/**
 * @typedef {Object} EditorPreferences
 * @property {boolean} wrap
 * @property {boolean} lineNumbers
 * @property {boolean} mdPreview
 * @property {boolean} tablePreview
 * @property {number} charWidth
 */
/**
 * @typedef {Object} AppState
 * @property {{meta: WorkspaceMeta|null, generation: number, metrics: object|null, connected: boolean, pending: boolean, error: string}} workspace
 * @property {{tabs: DocTab[], active: number, history: object[], historyIndex: number}} documents
 * @property {EditorPreferences} editor
 * @property {Object} navigation
 * @property {import('../state.js').LSPState} lsp
 * @property {Object<string, unknown>} settings
 * @property {{targets: object[]}} agents
 * @property {{unpushedCount: number, snapshot: object|null, revision: number}} git
 * @property {{viewed: Object<string, boolean>}} viewers
 * @property {{model: import('../viewers/orb-model.js').OrbModel|null, shown: boolean}} explanation
 */
/** @returns {AppState} */
function initialState() {
  return {
    layout: readLayout(localStorage.getItem('faah.layout')),
    workspace: {
      meta: /** @type {WorkspaceMeta|null} */ (null),
      generation: 0,
      metrics: null,
      note: '',
      reindexing: false,
      connected: false,
      pending: false,
      error: '',
    },
    documents: { tabs: /** @type {DocTab[]} */ ([]), active: -1, history: [], historyIndex: -1 },
    editor: /** @type {EditorPreferences} */ ({
      wrap: true,
      lineNumbers: true,
      mdPreview: true,
      tablePreview: true,
      charWidth: 7.8,
    }),
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
    settings: {},
    git: { unpushedCount: 0, snapshot: null, revision: 0 },
    viewers: { viewed: {} },
    explanation: { model: null, shown: false },
  };
}

/** A fresh store belongs to one mounted app. Legacy S remains confined to the bridge. */
export function createAppStore(options = {}) {
  const [state, set] = createStore(initialState());
  const documents = createDocuments(state, set, options);
  const activeDocument = createMemo(() => state.documents.tabs[state.documents.active] || null);
  const store = {
    state,
    activeDocument,
    buffers: documents.buffers,
    bufferRevision: documents.bufferRevision,
    actions: {
      ...documents,
      setViewed: (path, value) => set('viewers', 'viewed', path, value),
      setExplanation: (model) => set('explanation', 'model', reconcile(model)),
      setExplanationShown: (shown) => set('explanation', 'shown', shown),
      setNavigation: (patch) => set('navigation', patch),
      setGeometry: (patch) => set('editor', patch),
      setWorkspace: (meta) =>
        batch(() => {
          set('workspace', 'meta', reconcile(meta));
          if (meta?.metrics) set('workspace', 'metrics', reconcile(meta.metrics));
        }),
      patchWorkspace: (name, value) => set('workspace', 'meta', name, value),
      setEditorPreference: (name, value) => {
        if (!['wrap', 'lineNumbers', 'mdPreview', 'tablePreview'].includes(name))
          throw new Error('Unknown editor preference');
        set('editor', name, value);
      },
      setSetting: (name, value) => set('settings', name, value),
      setUnpushedCount: (count) => set('git', 'unpushedCount', count),
      setSettings: (settings) => set('settings', reconcile(settings)),
      acceptLspServers: (result) =>
        batch(() => {
          set('lsp', 'servers', reconcile(result.servers || [], { key: 'name' }));
          set('lsp', 'anyRunning', !!result.anyRunning);
        }),
      acceptLspReply: (reply, path = activeDocument()?.path) => {
        if (!reply?.state) return;
        const brief = {
          state: reply.state,
          server: reply.server || '',
          missing: reply.missing || '',
        };
        if (path) store.actions.patchDocument(path, { lsp: brief });
        if (path === activeDocument()?.path) set('lsp', brief);
      },
      setLsp: (lsp) => set('lsp', reconcile(lsp)),
      patchLsp: (name, value) => set('lsp', name, value),
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
