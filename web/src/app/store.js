import { createMemo } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';

/** @typedef {import('../state.js').DocTab} DocTab */
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
  };
}

/** A fresh store belongs to one mounted app. Legacy S remains confined to the bridge. */
export function createAppStore() {
  const [state, set] = createStore(initialState());
  const activeDocument = createMemo(() => state.documents.tabs[state.documents.active] || null);
  return {
    state,
    activeDocument,
    actions: {
      setWorkspace: (meta) => set('workspace', 'meta', reconcile(meta)),
      setEditorPreference: (name, value) => {
        if (!['wrap', 'lineNumbers', 'mdPreview', 'tablePreview'].includes(name))
          throw new Error('Unknown editor preference');
        set('editor', name, value);
      },
      setSettings: (settings) => set('settings', reconcile(settings)),
      setLsp: (lsp) => set('lsp', reconcile(lsp)),
      activateDocument: (index) => set('documents', 'active', index),
    },
  };
}
