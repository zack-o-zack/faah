import { createViewerActions } from '../viewers/actions.js';
import { createDocuments } from '../editor/documents.js';
import { createMemo } from 'solid-js';
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
 * @property {{meta: WorkspaceMeta|null, generation: number}} workspace
 * @property {{tabs: DocTab[], active: number, history: object[], historyIndex: number}} documents
 * @property {EditorPreferences} editor
 * @property {Object} navigation
 * @property {import('../state.js').LSPState} lsp
 * @property {Object<string, unknown>} settings
 * @property {{targets: object[]}} agents
 * @property {{unpushedCount: number}} git
 * @property {{viewed: Object<string, boolean>}} viewers
 * @property {{model: import('../viewers/orb-model.js').OrbModel|null, shown: boolean}} explanation
 */
/** @returns {AppState} */
function initialState() {
  return {
    workspace: { meta: /** @type {WorkspaceMeta|null} */ (null), generation: 0 },
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
    agents: { targets: [] },
    git: { unpushedCount: 0 },
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
      setAgentTargets: (targets) => set('agents', 'targets', targets),
      setNavigation: (patch) => set('navigation', patch),
      setGeometry: (patch) => set('editor', patch),
      setWorkspace: (meta) => set('workspace', 'meta', reconcile(meta)),
      patchWorkspace: (name, value) => set('workspace', 'meta', name, value),
      setEditorPreference: (name, value) => {
        if (!['wrap', 'lineNumbers', 'mdPreview', 'tablePreview'].includes(name))
          throw new Error('Unknown editor preference');
        set('editor', name, value);
      },
      setSettings: (settings) => set('settings', reconcile(settings)),
      setLsp: (lsp) => set('lsp', reconcile(lsp)),
      patchLsp: (name, value) => set('lsp', name, value),
    },
  };
  store.viewerActions = createViewerActions(store);
  return store;
}
