import { createAgentStore } from '../agents/store.js';
import { createThreadStore } from '../threads/store.js';
import { registerFeatureCommands } from '../palette/features.js';
import { createDocumentGitActions } from '../git/documents.js';
import { createLanguageStore } from '../lsp/store.js';
import { createSearchStore } from '../search/store.js';
import { createPaletteStore } from '../palette/store.js';
import { createGitStore } from '../git/store.js';
import { createTreeStore } from '../workspace/tree-store.js';
import { createSelectionActions } from './selection-actions.js';
import { createFindActions } from './find-actions.js';
import { createEditActions } from './edit-actions.js';
import { createHoverActions } from './hover-actions.js';
import { createVimActions } from './vim-actions.js';
import { createStore } from 'solid-js/store';
import { batch, createMemo, createSignal, onCleanup } from 'solid-js';
import { apiPostJson } from '../lib/api.js';
import { toast } from '../lib/toast.jsx';
import { codeWidth, LH } from './layout.js';
import { movePosition } from './cursor.js';
import { initialVimState } from './vim.js';

/** @returns {EditorUI} */
function initialState(vimEnabled) {
  return {
    opening: '',
    error: '',
    findLoading: false,
    findError: '',
    editLoading: false,
    editError: '',
    hoverLoading: false,
    hoverError: '',
    findOpen: false,
    query: '',
    caseSensitive: false,
    hits: [],
    activeHit: -1,
    selection: null,
    menu: null,
    hover: null,
    hoverPosition: null,
    vimEnabled,
    vimHelp: false,
    reviewAvailable: false,
    vim: initialVimState(),
  };
}
/**
 * @typedef {Object} EditorUI
 * @property {boolean} findOpen
 * @property {string} query
 * @property {boolean} caseSensitive
 * @property {object[]} hits
 * @property {number} activeHit
 * @property {object|null} selection
 * @property {object|null} menu
 * @property {object|null} hover
 * @property {object|null} hoverPosition
 * @property {boolean} vimEnabled
 * @property {boolean} vimHelp
 * @property {ReturnType<typeof initialVimState>} vim
 */
export function createEditorStore(store, options = {}) {
  const [ui, setUI] = createStore(
    initialState(localStorage.getItem('faah.editor.vimMode') === 'true'),
  );
  const [revision, bump] = createSignal(0);
  const [geometry, setGeometry] = createStore({
    width: 800,
    height: 600,
    top: 0,
    charWidth: 7.8,
    lineHeight: LH,
  });
  const services = {};
  const handlers = {};
  let openSequence = 0;
  const active = store.activeDocument;
  const buffer = createMemo(() => {
    store.bufferRevision();
    return store.buffers.get(active()?.path);
  });
  const patch = (update) => {
    if (active()) store.actions.patchDocument(active().path, update);
  };
  const refresh = () => bump((value) => value + 1);
  function offsets() {
    revision();
    buffer()?.revision();
    return (
      buffer()?.layout({
        wrap: store.state.editor.wrap,
        width: codeWidth(
          geometry.width,
          active()?.total,
          geometry.charWidth,
          store.state.editor.lineNumbers,
        ),
        charWidth: geometry.charWidth,
        lineHeight: geometry.lineHeight,
        estimate: active()?.total ? Math.round(active().size / active().total) : 0,
      }) || new Float64Array(1)
    );
  }
  function activateView() {
    editor.actions.clearFind();
    editor.actions.hideHover();
    setUI({ selection: null });
    store.actions.setNavigation({ at: null, link: null });
    services.activate?.(active());
    const document = active();
    if (document && editor.tree.autoReveal() && store.state.layout.left)
      void actions.revealFile(document.path);
    if (document && !document.gutterLoaded) void editor.actions.loadGutter(document.path);
    services.source?.scrollTo(document?.scrollTop || 0);
  }
  async function openFile(path, options) {
    const sequence = ++openSequence;
    setUI({ opening: path, error: '' });
    try {
      const document = await store.actions.openDocument(path, { ...options, activate: false });
      if (sequence !== openSequence || !document) return;
      store.actions.activateDocument(
        store.state.documents.tabs.findIndex((tab) => tab.path === path),
        { push: false },
      );
      if (options?.push !== false) store.actions.pushHistory(path, document.cur);
      batch(activateView);
      if (options?.line) centerLine(options.line);
    } catch (error) {
      if (sequence === openSequence) {
        setUI('error', error.message);
        toast('error', error.message);
      }
    } finally {
      if (sequence === openSequence) setUI('opening', '');
    }
  }
  function switchTab(index) {
    openSequence++;
    setUI('opening', '');
    if (index === store.state.documents.active) return;
    store.actions.activateDocument(index);
    batch(activateView);
  }
  function closeTabs(indices) {
    openSequence++;
    setUI('opening', '');
    const tabs = indices.map((index) => store.state.documents.tabs[index]).filter(Boolean);
    if (
      tabs.some((tab) => tab.dirty) &&
      !confirm('You have unsaved changes. Close anyway and discard changes?')
    )
      return;
    const removed = store.actions.closeDocuments(indices);
    for (const document of removed) {
      void apiPostJson('api/close', { path: document.path }).catch(() => {});
      editor.actions.cancelSymbols(document.path);
      services.closed?.(document);
    }
    activateView();
  }
  function centerLine(line) {
    if (active()?.isEditing) return editor.actions.centerEditLine(line);
    if (active()?.diffMode) return services.diff?.scrollLine(line);
    if (services.previewing?.()) return services.previewLine?.(line);
    const y = offsets()[Math.max(0, Math.min((active()?.total || 1) - 1, line - 1))] || 0;
    services.source?.scrollTo(Math.max(0, y - geometry.height / 2 + geometry.lineHeight * 2));
  }
  function move(delta, shift = false, axis = 'line') {
    const document = active();
    if (!document) return;
    const model = buffer();
    const position = movePosition(
      { line: document.cur, col: document.col || 0 },
      delta,
      model.text,
      document.total,
      axis,
    );
    const anchor = shift
      ? document.selAnchor || { line: document.cur, col: document.col || 0 }
      : null;
    patch({ cur: position.line, col: position.col, selAnchor: anchor });
    revealLine(position.line);
    editor.actions.syncSelection();
  }
  function revealLine(line) {
    const y = offsets()[line - 1] || 0;
    if (y < geometry.top || y + geometry.lineHeight * 2 > geometry.top + geometry.height)
      services.source?.scrollTo(Math.max(0, y - geometry.height / 2));
  }

  function edge(end, shift = false) {
    const document = active();
    if (!document) return;
    const anchor = shift
      ? document.selAnchor || { line: document.cur, col: document.col || 0 }
      : null;
    patch({ col: end ? buffer().text(document.cur - 1).length : 0, selAnchor: anchor });
    editor.actions.syncSelection();
  }
  const editor = {
    store,
    ui,
    setUI,
    services,
    handlers,
    geometry,
    setGeometry,
    revision,
    active,
    buffer,
    offsets,
  };
  const actions = {
    ...store.actions,
    openLink: openFile,
    refresh,
    patch,
    openFile,
    switchTab,
    async stepDiffFile(from, file) {
      const { diffRef: ref, diffBase: base, turnFiles, turnLabel } = from;
      await openFile(file.path, { ref, base, turnFiles, turnLabel, view: 'diff' });
      const index = store.state.documents.tabs.findIndex((tab) => tab.path === from.path);
      if (index >= 0 && active()?.path !== from.path && from.diffRef === ref) closeTabs([index]);
    },
    closeTabs,
    activateView,
    centerLine,
    revealLine,
    move,
    edge,
    toggleWrap(forced) {
      const wrap = typeof forced === 'boolean' ? forced : !store.state.editor.wrap;
      store.actions.setEditorPreference('wrap', wrap);
      localStorage.setItem('faah.wrap', String(wrap));
    },
  };
  editor.actions = actions;
  Object.assign(
    actions,
    createSelectionActions(editor),
    createFindActions(editor),
    createEditActions(editor),
    createHoverActions(editor),
    createVimActions(editor),
  );
  editor.agents = createAgentStore(editor, options.agents);
  Object.assign(actions, editor.agents.actions);
  editor.threads = createThreadStore(editor, options.threads);
  Object.assign(actions, editor.threads.actions);
  handlers.agent = actions.openAgentEdit;
  handlers.thread = actions.newThread;
  handlers.explain = actions.explainSelection;
  handlers.prepare = actions.prepareExplanation;
  editor.tree = createTreeStore(store, {
    openFile,
    enterEditMode: () => editor.actions.enterEditMode(),
  });
  Object.assign(actions, editor.tree.actions);
  editor.git = createGitStore(store, {
    openFile,
    runAgent: (...args) => actions.runAgentJob(...args),
    cancelAgent: (id) => actions.cancelAgentJob(id),
    historyChanged: () => actions.legacyHistoryChanged(),
  });
  Object.assign(actions, editor.git.actions);
  editor.search = createSearchStore();
  Object.assign(actions, editor.search.actions);
  editor.palette = createPaletteStore(editor, options);
  Object.assign(actions, editor.palette.actions);
  editor.language = createLanguageStore(editor, options.language);
  Object.assign(actions, editor.language.actions);
  Object.assign(actions, createDocumentGitActions(editor));
  actions.showFilesPanel = async () => {
    actions.setPanelVisible('left', true);
    await actions.setTreeMode('files');
  };
  actions.reindexWorkspace = async () => {
    if (!(await store.actions.reindexWorkspace())) return;
    await actions.refreshUnpushed();
    await actions.setTreeMode(editor.tree.hasGitView() ? 'git' : 'files');
    await actions.refreshTree();
    await actions.reloadOpenTabs();
    toast('success', 'Workspace refreshed');
  };
  onCleanup(registerFeatureCommands(editor, options.theme));
  return editor;
}
