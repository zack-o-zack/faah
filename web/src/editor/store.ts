import type { AppStore } from '../app/store.ts';
import type { EditorUI, CoreActions, EditorHost, Services, Geometry } from './contracts.ts';
import type { DocTab, OpenOptions } from './types.ts';
import type { Request } from '../lib/api.ts';
import type { ThemeStore } from '../lib/theme.ts';
import { errorMessage } from '../lib/decode.ts';
interface FeatureOptions {
  request?: Request;
  post?: Request;
}
interface EditorOptions {
  theme?: ThemeStore;
  agents?: FeatureOptions;
  threads?: FeatureOptions;
  review?: FeatureOptions;
  pr?: FeatureOptions;
  merge?: FeatureOptions;
  forge?: FeatureOptions;
  language?: FeatureOptions;
}
import { isPreview, previewKind } from '../viewers/view.ts';
import { createAgentStore } from '../agents/store.js';
import { createThreadStore } from '../threads/store.js';
import { createReviewStore } from '../review/store.js';
import { createPRStore } from '../pr/store.js';
import { createShortcutRegistry } from '../shortcuts/registry.ts';
import { createMergeStore } from '../pr/merge-store.js';
import { createForgeStore } from '../pr/forge-store.js';
import { registerFeatureCommands } from '../palette/features.js';
import { createDocumentGitActions } from '../git/documents.js';
import { createLanguageStore } from '../lsp/store.js';
import { createSearchStore } from '../search/store.js';
import { createPaletteStore } from '../palette/store.js';
import { createGitStore } from '../git/store.js';
import { createTreeStore } from '../workspace/tree-store.ts';
import { createSelectionActions } from './selection-actions.ts';
import { createFindActions } from './find-actions.ts';
import { createEditActions } from './edit-actions.ts';
import { createHoverActions } from './hover-actions.ts';
import { createVimActions } from './vim-actions.ts';
import { createStore } from 'solid-js/store';
import { batch, createMemo, createSignal, onCleanup } from 'solid-js';
import { apiPostJson } from '../lib/api.ts';
import { toast } from '../lib/toast.jsx';
import { codeWidth, LH } from './layout.ts';
import { movePosition } from './cursor.ts';
import { initialVimState } from './vim.ts';

function initialState(): EditorUI {
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
    vimHelp: false,
    vim: initialVimState(),
  };
}
export type EditorStore = ReturnType<typeof buildEditorStore>;
export function createEditorStore(store: AppStore, options: EditorOptions = {}): EditorStore {
  return buildEditorStore(store, options);
}
function buildEditorStore(store: AppStore, options: EditorOptions) {
  const [ui, setUI] = createStore(initialState());
  const [revision, bump] = createSignal(0);
  const [geometry, setGeometry] = createStore<Geometry>({
    width: 800,
    height: 600,
    top: 0,
    charWidth: 7.8,
    lineHeight: LH,
  });
  const services: Services = {};
  const handlers: EditorHost['handlers'] = {};
  let openSequence = 0;
  const active = store.activeDocument;
  const buffer = createMemo(() => {
    store.bufferRevision();
    const path = active()?.path;
    return path ? store.buffers.get(path) : undefined;
  });
  const patch = (update: Partial<DocTab>) => {
    const document = active();
    if (document) store.actions.patchDocument(document.path, update);
  };
  const refresh = () => bump((value) => value + 1);
  function offsets() {
    revision();
    buffer()?.revision();
    return (
      buffer()?.layout({
        wrap: store.settings.preferences().wrap,
        width: codeWidth(
          geometry.width,
          active()?.total,
          geometry.charWidth,
          store.settings.preferences().lineNumbers,
        ),
        charWidth: geometry.charWidth,
        lineHeight: geometry.lineHeight,
        estimate: active()?.total ? Math.round((active()?.size || 0) / (active()?.total || 1)) : 0,
      }) || new Float64Array(1)
    );
  }
  function activateView() {
    editor.actions.clearFind();
    editor.actions.hideHover();
    setUI({ selection: null });
    store.actions.setNavigation({ at: null, link: null });
    const document = active();
    if (document && tree.autoReveal() && store.state.layout.left)
      void actions.revealFile(document.path);
    if (document && !document.gutterLoaded) void editor.actions.loadGutter(document.path);
    services.source?.scrollTo(document?.scrollTop || 0);
  }
  async function openFile(path: string, options?: OpenOptions) {
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
      batch(() => {
        activateView();
        // Opening a file leaves the overview; closing a tab behind it does not.
        actions.setReviewMode('code');
      });
      if (options?.line) centerLine(options.line);
    } catch (error) {
      if (sequence === openSequence) {
        setUI('error', errorMessage(error));
        toast('error', errorMessage(error));
      }
    } finally {
      if (sequence === openSequence) setUI('opening', '');
    }
  }
  function switchTab(index: number) {
    openSequence++;
    setUI('opening', '');
    if (index === store.state.documents.active) return;
    store.actions.activateDocument(index);
    batch(activateView);
  }
  function closeTabs(indices: number[]) {
    openSequence++;
    setUI('opening', '');
    const tabs = indices.map((index) => store.state.documents.tabs[index]).filter(Boolean);
    if (
      tabs.some((tab) => tab?.dirty) &&
      !confirm('You have unsaved changes. Close anyway and discard changes?')
    )
      return;
    const removed = store.actions.closeDocuments(indices);
    for (const document of removed) {
      void apiPostJson('api/close', { path: document.path }).catch(() => {});
      language.actions.cancelSymbols(document.path);
    }
    activateView();
  }
  function centerLine(line: number): void {
    if (active()?.isEditing) return coreActions.centerEditLine(line);
    if (active()?.diffMode) return services.diff?.scrollLine(line);
    if (isPreview(active())) {
      store.actions.requestPreviewLine(active(), line);
      return services.preview?.line(line);
    }
    const y = offsets()[Math.max(0, Math.min((active()?.total || 1) - 1, line - 1))] || 0;
    services.source?.scrollTo(Math.max(0, y - geometry.height / 2 + geometry.lineHeight * 2));
  }
  function move(delta: number, shift = false, axis = 'line') {
    const document = active();
    if (!document) return;
    const model = buffer();
    if (!model) return;
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
  function revealLine(line: number) {
    const y = offsets()[line - 1] || 0;
    if (y < geometry.top || y + geometry.lineHeight * 2 > geometry.top + geometry.height)
      services.source?.scrollTo(Math.max(0, y - geometry.height / 2));
  }

  function edge(end: boolean, shift = false) {
    const document = active();
    if (!document) return;
    const anchor = shift
      ? document.selAnchor || { line: document.cur, col: document.col || 0 }
      : null;
    patch({ col: end ? buffer()?.text(document.cur - 1).length || 0 : 0, selAnchor: anchor });
    editor.actions.syncSelection();
  }
  const shortcutRegistry = createShortcutRegistry();
  const baseActions = {
    ...store.actions,
    ...store.settings.actions,
    ...store.actions,
    ...shortcutRegistry.actions,
    openLink: openFile,
    refresh,
    patch,
    openFile,
    switchTab,
    async stepDiffFile(from: DocTab, file: { path: string }) {
      const { diffRef: ref, diffBase: base, turnFiles, turnLabel } = from;
      await openFile(file.path, {
        ref,
        base,
        turnFiles: turnFiles || undefined,
        turnLabel,
        view: 'diff',
      });
      const index = store.state.documents.tabs.findIndex((tab) => tab.path === from.path);
      if (index >= 0 && active()?.path !== from.path && from.diffRef === ref) closeTabs([index]);
    },
    closeTabs,
    activateView,
    centerLine,
    revealLine,
    move,
    edge,
    /** Alt+M: the Markdown or table preview of the active file, kept at the same line. */
    toggleActivePreview() {
      const document = active();
      if (!previewKind(document)) {
        toast('error', 'Preview works on Markdown, CSV and TSV files');
        return;
      }
      const shown = isPreview(document);
      const line = shown
        ? services.preview?.topLine() || 1
        : services.source?.topLine?.() || document?.cur || 1;
      store.actions.togglePreview(document, line);
      if (shown) centerLine(line);
      if (ui.findOpen) void actions.executeFind();
    },
    toggleWrap(forced?: boolean) {
      const wrap = typeof forced === 'boolean' ? forced : !store.settings.preferences().wrap;
      void store.settings.actions.setSetting('editor.wordWrap', wrap ? 'on' : 'off');
    },
  };
  // Factories resolve peer actions after assembly; closures avoid unsafe construction casts.
  const coreActions: CoreActions = {
    ...baseActions,
    clearFind: () => findActions.clearFind(),
    hideHover: () => hoverActions.hideHover(),
    centerEditLine: (...args) => editActions.centerEditLine(...args),
    executeFind: (...args) => findActions.executeFind(...args),
    syncSelection: () => selectionActions.syncSelection(),
    clearSelection: () => selectionActions.clearSelection(),
    runSelectionAction: (...args) => selectionActions.runSelectionAction(...args),
    findReferences: (...args) => language.actions.findReferences(...args),
    gotoDefinition: (...args) => language.actions.gotoDefinition(...args),
    showCalls: (...args) => language.actions.showCalls(...args),
    loadGutter: (...args) => documentActions.loadGutter(...args),
    showHoverAtCaret: () => hoverActions.showHoverAtCaret(),
    openFind: (...args) => findActions.openFind(...args),
    jumpToHit: (...args) => findActions.jumpToHit(...args),
    openPalette: (...args) => palette.actions.openPalette(...args),
  };
  const editor: EditorHost = {
    actions: coreActions,
    store,
    settings: store.settings,
    ui,
    setUI,
    services,
    handlers,
    geometry,
    active,
    buffer,
    offsets,
  };

  const selectionActions = createSelectionActions(editor);
  const findActions = createFindActions(editor);
  const editActions = createEditActions(editor);
  const hoverActions = createHoverActions(editor);
  const vimActions = createVimActions(editor);
  const interactionActions = Object.assign(
    coreActions,
    selectionActions,
    findActions,
    editActions,
    hoverActions,
    vimActions,
  );
  const agents = createAgentStore(editor, options.agents);
  const agentEditor = Object.assign(editor, { agents });
  const threads = createThreadStore(agentEditor, options.threads);
  const threadEditor = Object.assign(agentEditor, { threads });
  const review = createReviewStore(threadEditor, options.review);
  const reviewEditor = Object.assign(threadEditor, { review });
  const pr = createPRStore(reviewEditor, options.pr);
  const prEditor = Object.assign(reviewEditor, { pr });
  const merge = createMergeStore(prEditor, options.merge);
  const forge = createForgeStore(prEditor, options.forge);
  const actions = Object.assign(
    interactionActions,
    agents.actions,
    threads.actions,
    review.actions,
    pr.actions,
    merge.actions,
    forge.actions,
  );
  handlers.review = actions.openPRComposer;
  handlers.agent = actions.openAgentEdit;
  handlers.thread = actions.newThread;
  handlers.explain = actions.explainSelection;
  handlers.prepare = actions.prepareExplanation;
  const tree = createTreeStore(store, { openFile, enterEditMode: () => actions.enterEditMode() });
  const git = createGitStore(store, {
    openFile,
    runAgent: agents.actions.runAgentJob,
    cancelAgent: agents.actions.cancelAgentJob,
    historyChanged: () => actions.historyChanged(),
  });
  const search = createSearchStore();
  const palette = createPaletteStore(prEditor, options);
  const language = createLanguageStore(prEditor, options.language);
  const documentActions = createDocumentGitActions(prEditor);
  const featureActions = Object.assign(
    actions,
    tree.actions,
    git.actions,
    search.actions,
    palette.actions,
    language.actions,
    documentActions,
    {
      async showFilesPanel() {
        actions.setPanelVisible('left', true);
        await tree.actions.setTreeMode('files');
      },
      async reindexWorkspace() {
        if (!(await store.actions.reindexWorkspace())) return;
        await git.actions.refreshUnpushed();
        await tree.actions.setTreeMode(tree.hasGitView() ? 'git' : 'files');
        await tree.actions.refreshTree();
        await editActions.reloadOpenTabs();
        toast('success', 'Workspace refreshed');
      },
      async historyChanged() {
        await featureActions.reindexWorkspace();
        if (pr.available()) await pr.actions.refreshPRMeta();
        await editActions.reloadOpenTabs();
      },
    },
  );
  const result = Object.assign(prEditor, {
    merge,
    forge,
    tree,
    git,
    search,
    palette,
    language,
    actions: featureActions,
    shortcuts: shortcutRegistry,
    revision,
    setGeometry,
  });
  onCleanup(
    store.settings.onSaved((keys) => {
      if (keys.includes('agent.harness')) void agents.actions.initializeAgents();
    }),
  );
  onCleanup(registerFeatureCommands(result, options.theme));
  return result;
}
