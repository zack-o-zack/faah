import { apiText } from '../lib/api.js';
import { previewKind as documentPreviewKind, viewMode, canDiff } from '../viewers/view.js';
import { sanitizeMarkdown as cleanMarkdown } from '../viewers/markdown-dom.js';
// Removed when the last legacy module is migrated.
import { createSourceDOM } from '../editor/source-dom.js';
import { createSymbolActions } from '../editor/symbols.js';
import { createEffect, createMemo, on, onCleanup } from 'solid-js';
import { S, $, $$, esc } from '../state.js';
import { api, apiPost, apiPostJson } from '../lib/api.js';
export { api, apiPost, apiPostJson };
import { isMac, keyLabel, keyParts, withKeys } from '../lib/keyboard.js';
export { isMac, keyLabel, withKeys };
export const MOD = isMac ? 'metaKey' : 'ctrlKey';

// Removed when the last legacy module is migrated.
export const keyCaps = (combo) =>
  keyParts(combo)
    .map((k) => '<kbd class="kbd">' + esc(k) + '</kbd>')
    .join('');

// The contents of a shortcut's <kbd class="kbd">: one cap per key in the desktop app, which
// styles nested caps, and the single label everywhere else.
export const shortcutHtml = (combo) =>
  document.documentElement.hasAttribute('data-shell') ? keyCaps(combo) : esc(keyLabel(combo));

/* Static markup names shortcuts the same way: data-keys fills a label (a <kbd class="kbd">
   gets shortcutHtml), data-caps fills key caps, and {combo} in a title is replaced. */
export function applyKeyLabels(root = document) {
  for (const el of $$('kbd[data-keys]', root)) el.innerHTML = shortcutHtml(el.dataset.keys);
  for (const el of $$(':not(kbd)[data-keys]', root)) el.textContent = keyLabel(el.dataset.keys);
  for (const el of $$('[data-caps]', root)) el.innerHTML = keyCaps(el.dataset.caps);
  for (const el of $$('[title*="{"]', root)) el.title = withKeys(el.title);
}

export const showToast = (kind, text, duration) => toast(kind, text, duration);
import { toast } from '../lib/toast.jsx';
import { listThemes, getStoredTheme, DEFAULT_THEME, chooseThemePreference } from '../lib/theme.js';
import { lineText, LH, CHUNK, OVERSCAN } from '../editor/layout.js';
import { SEL_KEYS, SEL_MENU_ITEMS, selectionRef, contextSnippet } from '../editor/selection.js';
export {
  LH,
  CHUNK,
  OVERSCAN,
  SEL_KEYS,
  SEL_MENU_ITEMS,
  listThemes,
  getStoredTheme,
  DEFAULT_THEME,
  chooseThemePreference,
};
let editorStore;
let themeStore;
let symbols;
let sourceDOM;
let hoverTimer;
const services = {};
const facades = new Map();
const extras = new Map();
export let vp, sizer, rowsEl, editor, editTextarea;
export function bindLegacyEditor(value, theme) {
  editorStore = value;
  themeStore = theme;
  symbols = createSymbolActions(value.store, {
    onChange: () => services.drawOutline?.(),
    acceptLsp: (value) => services.setLspState?.(value),
  });
  onCleanup(symbols.dispose);
  const metadata = new Proxy(
    {},
    {
      get: (_, key) => value.store.state.workspace.meta?.[key],
      set: (_, key, next) => {
        value.store.actions.patchWorkspace(key, next);
        return true;
      },
      ownKeys: () => Object.keys(value.store.state.workspace.meta || {}),
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    },
  );
  Object.defineProperty(S, 'meta', {
    configurable: true,
    get: () => (value.store.state.workspace.meta ? metadata : null),
    set: (next) => {
      value.store.actions.setWorkspace(next);
    },
  });
  const settings = new Proxy(
    {},
    {
      get: (_, key) => value.store.state.settings[key],
      set: (_, key, next) => {
        value.store.actions.setSetting(key, next);
        return true;
      },
      ownKeys: () => Object.keys(value.store.state.settings),
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    },
  );
  Object.defineProperty(S, 'settings', {
    configurable: true,
    get: () => settings,
    set: (next) => {
      value.store.actions.setSettings(next);
    },
  });
  Object.defineProperty(S, 'unpushedCount', {
    configurable: true,
    get: () => value.store.state.git.unpushedCount,
    set: (next) => {
      value.store.actions.setUnpushedCount(next);
    },
  });
  const mappings = {
    active: ['documents', 'active'],
    hist: ['documents', 'history'],
    histIdx: ['documents', 'historyIndex'],
    wrap: ['editor', 'wrap'],
    lineNumbers: ['editor', 'lineNumbers'],
    mdPreview: ['editor', 'mdPreview'],
    tablePreview: ['editor', 'tablePreview'],
    chW: ['editor', 'charWidth'],
    lh: ['editor', 'lineHeight'],
    occ: ['navigation', 'occurrence'],
    at: ['navigation', 'at'],
    lastWord: ['navigation', 'lastWord'],
    link: ['navigation', 'link'],
    agentTargets: ['agents', 'targets'],
  };
  for (const [name, [slice, key]] of Object.entries(mappings)) {
    Object.defineProperty(S, name, {
      configurable: true,
      get: () => value.store.state[slice][key],
      set: (next) => {
        if (slice === 'editor') value.store.actions.setGeometry({ [key]: next });
        else if (slice === 'navigation') value.store.actions.setNavigation({ [key]: next });
        else if (name === 'active') value.store.actions.activateDocument(next, { push: false });
        else if (name === 'agentTargets') value.store.actions.setAgentTargets(next);
      },
    });
  }
  const tabs = createMemo(() => {
    value.revision();
    return value.store.state.documents.tabs.map((tab) => legacyDocument(tab.path));
  });
  Object.defineProperty(S, 'tabs', {
    configurable: true,
    get: tabs,
  });
  Object.defineProperty(S, 'find', {
    configurable: true,
    get: () =>
      value.ui.findOpen && value.ui.query
        ? {
            q: value.ui.query,
            cs: value.ui.caseSensitive,
            hits: value.ui.hits,
            active: value.ui.activeHit,
            byLine: new Set(value.ui.hits.filter(Boolean).map((hit) => hit.line)),
            preview: previewing(),
            editing: !!value.active()?.isEditing,
          }
        : null,
    set: () => {
      value.setUI({ hits: [], activeHit: -1 });
    },
  });
  Object.defineProperty(S, 'selAll', {
    configurable: true,
    get: () => (value.ui.selection?.all ? doc_() : null),
    set: (next) => {
      if (!next) value.setUI('selection', null);
    },
  });
  const lsp = new Proxy(
    {},
    {
      get: (_, key) => value.store.state.lsp[key],
      set: (_, key, next) => {
        value.store.actions.patchLsp(key, next);
        return true;
      },
    },
  );
  Object.defineProperty(S, 'lsp', {
    configurable: true,
    get: () => lsp,
    set: (next) => {
      value.store.actions.setLsp({ ...next });
    },
  });
}
export function attachLegacyDOM() {
  vp = $('#viewport');
  sizer = $('#sizer');
  rowsEl = $('#rows');
  editor = $('#editor');
  editTextarea = $('#editview-textarea');
  sourceDOM = createSourceDOM(rowsEl, doc_);
  diffview = $('#diffview');
  onCleanup(() => clearTimeout(hoverTimer));
}

function legacyDocument(path) {
  const model = editorStore.store.buffers.get(path);
  const cached = facades.get(path);
  if (cached?.buffer === model && cached?.generation === model?.generation) return cached.value;
  extras.delete(path);
  const generation = model?.generation;
  const facade = new Proxy(
    { path },
    {
      get(_, key) {
        const buffer = editorStore.store.buffers.get(path);
        if (key === 'lines') return buffer?.lines;
        if (key === 'chunks') return buffer?.chunks;
        if (key === 'pending') return new Set(buffer?.pending.keys());
        if (key === 'refining') return new Set(buffer?.refining.keys());
        if (key === 'gen') return buffer?.revision() || 0;
        if (key === 'editContent') return buffer?.editContent;
        if (key === 'path') return path;
        return (
          extras.get(path)?.[key] ??
          editorStore.store.state.documents.tabs.find((tab) => tab.path === path)?.[key]
        );
      },
      set(_, key, value) {
        const buffer = editorStore.store.buffers.get(path);
        if (buffer !== model || buffer?.generation !== generation) return true;
        if (key === 'editContent') {
          if (buffer) buffer.setEditContent(value);
          return true;
        }
        if (key === 'gen' || key === 'reqGen') {
          editorStore.actions.refresh();
          return true;
        }
        if (['gutter'].includes(key)) {
          if (!extras.has(path)) extras.set(path, {});
          extras.get(path)[key] = value;
          editorStore.actions.refresh();
          return true;
        }
        editorStore.store.actions.patchDocument(path, { [key]: value });
        return true;
      },
    },
  );
  facades.set(path, { buffer: model, generation: model?.generation, value: facade });
  return facade;
}
export function configureLegacyServices(value) {
  Object.assign(services, value);
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  // Until the following checkpoints replace these views, snapshots notify their DOM adapters.
  createEffect(
    on(
      () => editorStore.store.state.git.revision,
      () => {
        const snapshot = editorStore.store.state.git.snapshot;
        if (snapshot && !disposed) void paintLegacyGitSnapshot(snapshot).catch(console.error);
      },
    ),
  );
  createEffect(
    on(
      () => editorStore.store.state.workspace.metrics,
      (metrics) => {
        if (metrics) value.updateMetricsDisplay(metrics);
      },
    ),
  );
  const {
    openSettings,
    openLspMenu,
    startAllLsp,
    stopAllLsp,
    showRightInspector,
    hideRightInspector,
    showHelp,
    reindexWorkspace,
    newThread,
    deleteCurrentThread,
    showThreadsSidebar,
    navigateToTips,
    showTipWidget,
    copyToClipboard,
    copyRichToClipboard,
  } = value;
  const gotoDefinition = value.gotoDefinition;
  const findReferences = value.findReferences;
  const showCalls = value.showCalls;
  const showPanel = value.showPanel;
  editorStore.actions.showFilesPanel = () => value.showPanel('files');
  editorStore.actions.openLegacyPR = value.launchPR;
  editorStore.actions.loadSymbols = () => loadOutline({ upgrade: false });
  const releaseCommands = editorStore.palette.commands.register([
    {
      name: withKeys('File: Copy Source Code ({Mod+C})'),
      run: () => {
        const info = getSelectedRangeInfo();
        const d = doc_();
        if (info && info.text) {
          copyToClipboard(info.text, 'Copied source code');
        } else if (d) {
          getDocRaw(d).then((raw) => copyToClipboard(raw, `Copied ${d.name} (${d.total} lines)`));
        }
      },
    },
    {
      name: 'File: Copy Raw Markdown',
      run: () => {
        const d = doc_();
        if (!d) return;
        const info = getSelectedRangeInfo();
        if (info && info.rawMarkdown) {
          copyToClipboard(info.rawMarkdown, 'Copied raw Markdown');
        } else {
          getDocRaw(d).then((raw) => copyToClipboard(raw, `Copied ${d.name} (${d.total} lines)`));
        }
      },
    },
    {
      name: 'File: Copy Formatted Text (Markdown Preview)',
      run: () => {
        const info = getSelectedRangeInfo();
        if (info && info.isMarkdownPreview) {
          copyRichToClipboard(info.text, info.html, 'Copied formatted text');
        } else {
          const d = doc_();
          if (d) getDocRaw(d).then((raw) => copyToClipboard(raw, `Copied ${d.name}`));
        }
      },
    },
    {
      name: 'File: Copy Relative Path',
      run: () => {
        const d = doc_();
        if (d) copyToClipboard(d.path, `Copied ${d.path}`);
      },
    },
    {
      name: withKeys('File: Edit Current File ({Mod+E})'),
      run: () => {
        const d = doc_();
        if (d && !d.isImage && !d.deleted && !d.diffRef) {
          if (d.isEditing) exitEditMode();
          else enterEditMode();
        }
      },
    },
    { name: withKeys('File: Save File ({Mod+S})'), run: () => saveActiveFile() },
    { name: 'File: New File…', run: () => promptNewItem('file') },
    { name: 'File: New Folder…', run: () => promptNewItem('dir') },
    { name: withKeys('Preferences: Open Settings (UI) ({Mod+,})'), run: () => openSettings('ui') },
    { name: 'Preferences: Open Settings (JSON)', run: () => openSettings('json') },
    { name: 'Go to File…', run: () => openPalette('file') },
    { name: 'Go to Symbol in File…', run: () => openPalette('symbol') },
    { name: 'Go to Line…', run: () => openPalette('line') },
    { name: 'Search in Files', run: () => showRightInspector('search') },
    { name: 'Find in Current File', run: () => openFind(S.lastWord) },
    { name: 'Show Symbol Documentation (Shift+F1)', run: showHoverAtCaret },
    { name: 'Go to Definition', run: () => gotoDefinition() },
    { name: 'Find All References (Right Panel)', run: () => findReferences() },
    {
      name: withKeys('Show Call Trail: Callers / Callees ({Alt+Shift+H})'),
      run: () => showCalls(),
    },
    { name: 'Language Servers: Setup & Manage…', run: () => openLspMenu() },
    { name: 'Set Up Language Server…', run: () => openLspMenu() },
    { name: 'Language Servers: Start All', run: startAllLsp },
    { name: 'Language Servers: Stop All', run: stopAllLsp },
    {
      name: 'Toggle Right Sidebar / Inspector',
      run: () => {
        if (document.body.classList.contains('right-hidden')) showRightInspector();
        else hideRightInspector();
      },
    },
    { name: 'Show File Symbols (Right Panel)', run: () => showRightInspector('symbols') },
    {
      name: 'Reveal Active File in Explorer',
      run: () => {
        const d = doc_();
        if (d) {
          showPanel('files');
          revealFile(d.path);
        }
      },
    },
    { name: withKeys('Toggle Word Wrap ({Alt+Z})'), run: () => toggleWordWrap() },
    { name: withKeys('Toggle Markdown / Table Preview ({Alt+M})'), run: () => togglePreview() },
    {
      name: withKeys('Toggle Sidebar ({Mod+B})'),
      run: () => document.body.classList.toggle('side-hidden'),
    },
    { name: 'Select Theme…', run: () => openPalette('theme') },
    { name: 'Next Theme', run: cycleTheme },
    { name: 'Re-index Workspace', run: reindexWorkspace },
    {
      name: 'Close Tab',
      run: () => {
        if (S.active >= 0) closeTab(S.active);
      },
    },
    { name: 'Close All Tabs', run: () => closeAllTabs() },
    { name: withKeys('Reopen Closed Tab ({Alt+Shift+T})'), run: () => reopenClosedTab() },
    { name: 'Threads: Show All', run: () => showThreadsSidebar() },
    {
      name: withKeys('Threads: Start New Thread ({Alt+T} on a selection)'),
      run: () => newThread(null),
    },
    { name: 'Threads: Delete Current Thread', run: deleteCurrentThread },
    { name: 'Git: Open Pull Request…', run: () => openPalette('openpr', '') },
    {
      name: 'Preferences: Toggle Vim Keybindings',
      run: () => setVimModeEnabled(!isVimEnabled(), true),
    },
    { name: 'Help: Vim Keybindings Cheat Sheet', run: showVimHelp },
    { name: 'Help: Tips & Tricks (All Tips)', run: () => navigateToTips() },
    { name: 'Help: Show Tip', run: () => showTipWidget() },
    { name: 'Keyboard Shortcuts', run: showHelp },
  ]);
  onCleanup(releaseCommands);
  Object.assign(editorStore.actions, {
    openLegacySettings: value.openSettings,
    nudgeLegacyForgeToken: value.nudgeForgeToken,
    selectLegacyAgent: value.selectAgent,
    legacyAgentModels: value.loadPickerModels,
    cancelLegacyAgentJob: (id) => apiPostJson('api/agent/cancel', { id }),
    async legacyHistoryChanged() {
      await value.reindexWorkspace();
      if (S.meta?.pr) await value.refreshPRMeta();
      await reloadOpenTabs();
    },
    async runLegacyAgentJob(endpoint, params, { signal, progress }) {
      const job = await apiPostJson(endpoint, params, { signal });
      while (!signal.aborted) {
        await new Promise((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            reject(new DOMException('Cancelled', 'AbortError'));
          };
          const timer = setTimeout(() => {
            signal.removeEventListener('abort', abort);
            resolve();
          }, 600);
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        });
        const result = await api('api/agent/job', { id: job.id }, { signal });
        progress?.({ ...result, id: job.id });
        if (result.running) continue;
        if (result.error && !endpoint.endsWith('sync-agent')) throw new Error(result.error);
        return result;
      }
      throw new DOMException('Cancelled', 'AbortError');
    },
  });
  const releases = [
    value.on('pr:resolve', () => void editorStore.actions.resolvePRBase()),
    value.on('pr:force-push', editorStore.actions.confirmForcePush),
    value.on('pr:pull', () => void editorStore.actions.pullGit()),
  ];
  onCleanup(() => releases.forEach((release) => release?.()));
  createEffect(
    on(
      () => [
        editorStore.git.state.pending,
        editorStore.git.state.sync.inProgress,
        editorStore.git.state.sync.rewritten,
      ],
      () =>
        value.emit('git:sync', {
          running: !!editorStore.git.state.pending,
          inProgress: editorStore.git.state.sync.inProgress || '',
          rewritten: !!editorStore.git.state.sync.rewritten,
        }),
    ),
  );
  editorStore.actions.openLink = async (path, options) => {
    try {
      const clean = path.replace(/\/+$/, '');
      const parent = clean.slice(0, Math.max(0, clean.lastIndexOf('/')));
      const result = await api('api/tree', { dir: parent });
      if (!clean || result.children.some((entry) => entry.path === clean && entry.dir)) {
        await value.showPanel('files');
        await value.revealDir(clean);
        return;
      }
    } catch {
      // The document action reports missing paths or a closing workspace.
    }
    return editorStore.actions.openFile(path, options);
  };
  editorStore.services.stepDiffFile = async (from, file) => {
    const { diffRef: ref, diffBase: base, turnFiles, turnLabel } = from;
    await openFile(file.path, { ref, base, turnFiles, turnLabel, view: 'diff' });
    const index = S.tabs.findIndex((tab) => tab.path === from.path);
    if (index >= 0 && from.path !== doc_()?.path && from.diffRef === ref) closeTab(index);
  };
  Object.assign(editorStore.services, {
    activate() {
      const document = doc_();
      if (!document) {
        $('#empty').hidden = false;
        syncViewers();
        value.updateStatus();
        return;
      }
      $('#empty').hidden = true;
      S.lsp = document.lsp || { state: 'off', server: '' };
      syncViewers();
      value.warmLSP(document);
      if ($('#pane-right-symbols')?.classList.contains('active')) void loadOutline();
      if (!document.gutterLoaded) void loadGutter(document);
      value.updateStatus();
      value.emit('tab:activated', { doc: document });
      if (
        editorStore.tree.autoReveal() &&
        !globalThis.document.body.classList.contains('side-hidden')
      ) {
        void editorStore.actions.revealFile(document.path);
      }
    },
    closed(document) {
      symbols.cancel(document.path);
      facades.delete(document.path);
      extras.delete(document.path);
      value.emit('tab:closed', { doc: document });
      if (!S.tabs.length) value.emit('tabs:cleared');
    },
    syncViewers,
    getDocRaw,
    modKey: MOD,
    viewerWord(event, definition) {
      const word = wordAtPoint(event.clientX, event.clientY);
      if (!word) return;
      S.at = word;
      S.lastWord = word.word;
      if (definition) {
        event.preventDefault();
        value.gotoDefinition(word, { view: event.altKey ? 'source' : 'diff' });
      } else hoverAt(event.clientX, event.clientY);
    },
    loadGutter: (path) => loadGutter(legacyDocument(path)),
    saved: value.triggerRefresh,
    previewing,
    previewLine,
    findPreview(query, cs) {
      return editorStore.services.preview?.find(query, cs) || [];
    },
    showPreviewHit,
    clearPreviewMarks,
    hoverAllowed: () =>
      S.settings?.['lsp.hover.enabled'] !== false &&
      S.settings?.['lsp.enabled'] !== false &&
      ['ready', 'indexing'].includes(S.lsp.state),
    showHelp: value.showHelp,
    vimPreference: (enabled) => {
      S.settings['editor.vimMode'] = enabled;
    },
    previewTopLine,
    definition(at, options) {
      const document = editorStore.active();
      if (document) editorStore.store.actions.pushHistory(document.path, document.cur);
      return value.gotoDefinition(at || editorStore.actions.wordAtCaret(), options);
    },
    selectAll,
    selectPreview,
    references: (at) => value.findReferences(at || editorStore.actions.wordAtCaret()),
    calls: (at) => value.showCalls(at || editorStore.actions.wordAtCaret()),
    lspState: value.setLspState,
    copy: value.copyToClipboard,
    palette: () => value.openPalette('command'),
    beforeUnload: value.beforeUnload,
    blocked: () => !!$('dialog[open]') || !!$('#overlay')?.open,
    selectionAction,
  });
}
export const doc_ = () =>
  editorStore?.active() ? legacyDocument(editorStore.active().path) : null;
export const openFile = (path, options) =>
  editorStore.actions.openFile(path, {
    layout: localStorage.getItem('faah.diffLayout') || 'split',
    ...options,
  });
export const switchTab = (index) => editorStore.actions.switchTab(index);
export const closeTab = (index) => editorStore.actions.closeTabs([index]);
export const closeAllTabs = () => editorStore.actions.closeTabs(S.tabs.map((_, index) => index));
export const reopenClosedTab = () =>
  editorStore.store.actions.reopenDocument()?.then(editorStore.actions.activateView);
export const reloadOpenTabs = () => editorStore.actions.reloadOpenTabs();
export const centerLine = (line) => editorStore.actions.centerLine(line);
export const jumpToSourceLine = (line) => {
  const document = activeDocument();
  if (document) viewerActions().setView(document, 'source');
  editorStore.actions.patch({ cur: line });
  editorStore.actions.centerLine(line);
  syncViewers();
};
export const pushHistory = (path, line) => editorStore.store.actions.pushHistory(path, line);
export const go = (delta) =>
  editorStore.store.actions.historyGo(delta).then(editorStore.actions.activateView);
export const drawTabs = () => editorStore.actions.refresh();

export function measure() {
  const marker = $('#measure');
  if (!marker) return;
  marker.textContent = 'x'.repeat(100);
  const rect = marker.getBoundingClientRect();
  const lineHeight =
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lh')) || LH;
  const charWidth = rect.width / 100 || 7.8;
  editorStore.setGeometry({ lineHeight, charWidth });
  editorStore.store.actions.setGeometry({ lineHeight, charWidth });
}
export const layout = () => editorStore?.actions.refresh();
export const render = layout;
export const paint = layout;

export const toggleWordWrap = (forced) => editorStore.actions.toggleWrap(forced);
export function toggleLineNumbers(forced) {
  const value = typeof forced === 'boolean' ? forced : !S.lineNumbers;
  editorStore.store.actions.setEditorPreference('lineNumbers', value);
  document.body.classList.toggle('hide-lines', !value);
}
export function applyEditorTypography(fontSize, fontFamily, lineHeight, tabSize) {
  const style = document.documentElement.style;
  if (fontSize) style.setProperty('--fs', fontSize + 'px');
  if (fontFamily) style.setProperty('--mono', fontFamily);
  if (lineHeight || fontSize)
    style.setProperty('--lh', (lineHeight || Math.round(fontSize * 1.5)) + 'px');
  if (tabSize) style.setProperty('--tab-size', tabSize);
  measure();
}
export function updateEditorOptionControls() {
  $('[data-action="wrap"]')?.setAttribute('aria-pressed', String(S.wrap));
}
export const highlightRange = (path, l1, l2) =>
  editorStore.store.actions.setNavigation({ reference: { path, l1, l2 } });

export const wordAtPoint = (x, y) => sourceDOM.wordAtPoint(x, y);

export const updateDomSelection = () => editorStore.actions.syncSelection();

export const openFind = (seed) => editorStore.actions.openFind(seed);
export const clearFind = () => editorStore.actions.clearFind();
export const executeFind = (delta) => editorStore.actions.executeFind(delta);
export const runFind = () => editorStore.actions.executeFind();

export const jumpToHit = (index) => editorStore.actions.jumpToHit(index);

export function onMove({ x, y, mod }) {
  clearTimeout(hoverTimer);
  if (mod) {
    hideHover();
    editorStore.store.actions.setNavigation({ link: wordAtPoint(x, y) });
    return;
  }
  editorStore.store.actions.setNavigation({ link: null });
  if (editorStore.ui.hover || editorStore.services.hoverAllowed?.() === false) return;
  hoverTimer = setTimeout(() => hoverAt(x, y), 380);
}
export const hoverAt = (x, y) => showHover(wordAtPoint(x, y), x, y);
export const showHover = (...args) => editorStore.actions.showHover(...args);
export const showHoverAtCaret = () => editorStore.actions.showHoverAtCaret();
export const hideHover = () => editorStore.actions.hideHover();

export const enterEditMode = (line) => editorStore.actions.enterEditMode(line);
export const exitEditMode = (force) => editorStore.actions.exitEditMode(force);
export const saveActiveFile = () => editorStore.actions.saveActiveFile();
export const centerEditLine = (...args) => editorStore.actions.centerEditLine(...args);

export const isVimEnabled = () => editorStore.ui.vimEnabled;

export const setVimModeEnabled = (value, persist = true) =>
  editorStore.actions.setVimEnabled(value, persist);
export const handleVimKeyDown = (event) => editorStore.actions.handleVimKeyDown(event);
export const showVimHelp = () => editorStore.actions.showVimHelp();

export const currentTheme = () => themeStore.current();
export const setTheme = (id, persist) => themeStore.setTheme(id, persist);
export function cycleTheme() {
  const all = listThemes();
  const next = all[(all.findIndex((theme) => theme.id === currentTheme()) + 1) % all.length];
  if (next) {
    setTheme(next.id);
    toast('Theme', next.name);
  }
}
export const onThemeChanged = (fn) => createEffect(on(themeStore.current, fn, { defer: true }));
export const setAgentHandler = (fn) => {
  editorStore.handlers.agent = fn;
};
export const setThreadHandler = (fn) => {
  editorStore.handlers.thread = fn;
};
export const setExplainHandler = (fn) => {
  editorStore.handlers.explain = fn;
};
export const setExplainPrepareHandler = (fn) => {
  editorStore.handlers.prepare = fn;
};
export const setReviewHandler = (fn) => {
  editorStore.handlers.review = fn;
  editorStore.setUI('reviewAvailable', !!fn);
};
export const getReviewHandler = () => editorStore.handlers.review;
export const getSelectedRangeInfo = () => editorStore.ui.selection;
export const hideSelectionBar = () => editorStore.actions.setSelection(null);

export const closeSelMenu = () => editorStore.actions.closeSelectionMenu();
export const openLineMenu = (info, x, y) => editorStore.actions.openSelectionMenu(info, x, y);
export const runSelectionAction = (action, trigger, override) =>
  editorStore.actions.runSelectionAction(action, trigger, override);

export async function selectAll() {
  const document = doc_();
  if (!document) return;
  const target = activeDocument();
  const buffer = editorStore.store.buffers.get(document.path);
  const text = await getDocRaw(document);
  if (activeDocument() !== target || editorStore.store.buffers.get(document.path) !== buffer)
    return;
  S.selAll = document;
  editorStore.setUI('selection', {
    text,
    path: document.path,
    l1: 1,
    l2: document.total,
    all: true,
  });
}

function selectionAction(action, info, trigger) {
  if (!info) {
    if (!['thread', 'agent-edit'].includes(action)) return false;
    const document = doc_();
    if (!document) return false;
    info = {
      path: document.path,
      l1: document.cur,
      l2: document.cur,
      text: lineText(document.lines?.[document.cur - 1] || ''),
    };
  }
  const handlers = editorStore.handlers;
  const direct = {
    thread: handlers.thread,
    'agent-edit': handlers.agent,
    explain: handlers.explain,
    'review-comment': handlers.review,
  };
  if (action === 'explain' && (info.isMarkdownPreview || info.text.length > 12000)) return false;
  if (direct[action]) {
    direct[action](info);
    return true;
  }
  if (action === 'usages') {
    services.findReferences(info.text.split(/\s+/)[0]);
    return true;
  }
  if (action === 'copy-preview-text') {
    services.copyRichToClipboard(info.text, info.html || '', 'Copied formatted text', trigger);
    return true;
  }
  if (action === 'copy-markdown') {
    if (info.rawMarkdown)
      services.copyToClipboard(info.rawMarkdown, 'Copied raw Markdown', trigger);
    else
      getDocRaw(doc_())
        .then((text) => {
          const lines = text
            .split(/\r?\n/)
            .slice(info.l1 - 1, info.l2)
            .join('\n');
          services.copyToClipboard(lines || text, 'Copied raw Markdown', trigger);
        })
        .catch(() => services.copyToClipboard(info.text, 'Copied Markdown', trigger));
    return true;
  }

  const values = {
    'copy-ref': selectionRef(info),
    'copy-source': info.text,
    'copy-agent': contextSnippet(info),
  };
  if (values[action] === undefined) return false;
  services.copyToClipboard(values[action], 'Copied', trigger);
  return true;
}
export async function loadGutter(document) {
  if (!document || !S.meta?.git) return;
  const ref = document.diffRef || '';
  try {
    const result = await api('api/gutter', { path: document.path, ref });
    if ((document.diffRef || '') !== ref) return;
    document.gutterLoaded = true;
    document.diffAvailable = !!(result.available || document.diffBase);
    if (
      document.diffAvailable &&
      !document.diffMode &&
      !document.diffDismissed &&
      document.openedInDiffView
    ) {
      document.diffMode = localStorage.getItem('faah.diffLayout') || 'split';
      if (doc_() === document) syncViewers();
    }
    const marks = new Map();
    for (const line of result.modified || []) marks.set(line, 'mod');
    for (const line of result.added || []) marks.set(line, 'add');
    document.gutter = result.available ? { marks, dels: new Set(result.deleted) } : null;
    editorStore.store.actions.patchDocument(document.path, { gutter: document.gutter });
    editorStore.actions.refresh();
    services.updateStatus?.();
  } catch {
    /* Git can disappear while a workspace is closing. */
  }
}
export async function loadOutline({ upgrade = true } = {}) {
  const document = doc_();
  if (!document) return;
  try {
    await symbols.load(document.path);
    if (upgrade) await symbols.upgrade(document.path);
  } catch {
    /* A closing workspace can drop symbol requests. */
  }
}

export const drawOutline = () => services.drawOutline?.();

// Phase B/C consumers keep their imperative calls at this boundary.
const activeDocument = () => editorStore?.active();
const viewerActions = () => editorStore.actions;
export const previewKind = (document = activeDocument()) => documentPreviewKind(document);
export const previewing = (document = activeDocument()) =>
  ['markdown', 'table'].includes(viewMode(document));
export const previewLine = (line) => {
  viewerActions().requestPreviewLine(activeDocument(), line);
  editorStore.services.preview?.line(line);
};
export const previewTopLine = () => editorStore.services.preview?.topLine() || 1;
export const findInPreview = (query, sensitive) =>
  (editorStore.services.preview?.find(query, sensitive) || []).length;
export const showPreviewHit = (index) => editorStore.services.preview?.showHit(index);
export const clearPreviewMarks = () => editorStore.services.preview?.clearMarks();
export const selectPreview = () => editorStore.services.preview?.select();
export const previewKey = (event) => editorStore.services.preview?.key(event) || false;
export function togglePreview() {
  const document = activeDocument();
  if (!previewKind(document))
    return showToast('error', 'Preview works on Markdown, CSV and TSV files');
  const shown = previewing();
  const line = shown ? previewTopLine() : editorStore.services.source?.topLine?.() || document.cur;
  viewerActions().togglePreview(document, line);
  if (shown) editorStore.actions.centerLine(line);
  if (editorStore.ui.findOpen) void editorStore.actions.executeFind();
  services.updateStatus?.();
}
export const handleImageKey = (event) => editorStore.services.imageKey?.(event) || false;
export const exitMermaidFullscreen = () => {
  for (const exit of editorStore.services.diagramFullscreens || []) if (exit()) return true;
  return false;
};
export const getDocRaw = (document) =>
  document
    ? apiText('api/raw', { path: document.path, ref: document.diffRef || '' })
    : Promise.resolve('');
export const sanitizeMarkdown = (html) => cleanMarkdown(html);
export let diffview;
export const setPRSyncHandler = (handler) => {
  editorStore.services.diffRendered = handler;
};
export const syncViewers = () => editorStore.services.diffRendered?.();
export function syncDiffView(force = false) {
  if (force || activeDocument()?.diffMode) viewerActions().invalidate(activeDocument());
  editorStore.services.diffRendered?.();
}
export const setLayoutPref = (mode) => localStorage.setItem('faah.diffLayout', mode);
export const toggleDiff = () => {
  const document = activeDocument();
  if (!canDiff(document, editorStore.store.state.workspace.meta)) return;
  viewerActions().setDiffMode(
    document,
    document.diffMode ? 'source' : localStorage.getItem('faah.diffLayout') || 'split',
  );
  services.updateStatus?.();
};
export const stepDiffHunk = (direction) => editorStore.services.diff?.stepHunk(direction);
export const stepChangedFile = async (direction) => {
  const document = activeDocument();
  if (!document) return;
  let files = document.turnFiles;
  if (!files && document.diffRef)
    files = (await api('api/commitfiles', { sha: document.diffRef })).files;
  files ||= (editorStore.store.state.workspace.meta?.gitFiles || []).map((path) => ({ path }));
  files = files
    .map((file) => (typeof file === 'string' ? { path: file } : file))
    .filter((file) => !file.binary);
  const index = files.findIndex((file) => file.path === document.path);
  const next = files[index + direction];
  if (next) editorStore.services.stepDiffFile?.(document, next);
};
export const isFileViewed = (path) => !!editorStore.store.state.viewers.viewed[path];
export function focusDiffScope(document) {
  const actual = editorStore.store.state.documents.tabs.find((tab) => tab.path === document?.path);
  if (!actual || !editorStore.store.state.workspace.meta?.pr) return;
  editorStore.actions.focusTreeScope(actual);
}
let orbHooks;
export function initOrb(hooks) {
  orbHooks = hooks;
  editorStore.services.openExplanation = hooks.open;
  const observer = new MutationObserver(orbSync);
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  onCleanup(() => observer.disconnect());
}
export const orbSync = () =>
  viewerActions().showOrbThread(
    !!orbHooks?.showing(editorStore.store.state.explanation.model?.id || null),
  );
export const orbBegin = () => {
  viewerActions().orbBegin();
  orbSync();
};
export const orbAttach = (thread) => {
  viewerActions().orbAttach(thread);
  orbSync();
};
export const orbFailed = (message) => {
  viewerActions().orbFailed(message);
  orbSync();
};
export const orbThread = (thread) => {
  viewerActions().orbThread(thread);
  orbSync();
};
export const orbStep = (id, text) => viewerActions().orbStep(id, text);
export const orbSummary = (summary) => {
  viewerActions().orbSummary(summary);
  orbSync();
};

let legacyGitSignature = '';
export const handleGitStatus = (snapshot) => editorStore.actions.acceptGitSnapshot(snapshot);
export const triggerRefresh = () => editorStore.actions.refreshWorkspace();
export const initGitStream = () => editorStore.actions.startWorkspaceStream();
export const onStream = (name, handler) =>
  editorStore.actions.subscribeWorkspaceEvent(name, handler);
export const setStreamTopic = (name, enabled) =>
  editorStore.actions.setWorkspaceTopic(name, enabled);
export const watchThread = (id) => editorStore.actions.watchWorkspaceThread(id);
async function paintLegacyGitSnapshot(data) {
  if (!data) return;

  // Identical snapshot to the last one applied (refocus, SSE reconnect): the
  // tree, panel and gutters are already right. Open modified tabs are still
  // re-checked, since a file can change on disk while its status stays "M",
  // but they only repaint if something actually differs.
  const sig = JSON.stringify(data);
  if (sig === legacyGitSignature) {
    await reloadOpenTabs({ onlyIfChanged: true });
    return;
  }
  legacyGitSignature = sig;

  // Before the Git-view check below: committing empties the tree but fills the
  // Unpushed section, and pushing empties that in turn, so whether Git view
  // still has anything to show depends on a fresh unpushed count.
  // Cheap: only re-reads git log when the ahead count or head commit moved.

  await editorStore.actions.reconcileTreeSnapshot();
  const statuses = data.statuses || {};

  // Close tabs that were opened in git diff view or currently in diff view if their changes are gone.
  // In PR review mode, tabs should remain open even if clean relative to HEAD.
  if (!S.meta?.pr) {
    for (let i = S.tabs.length - 1; i >= 0; i--) {
      const t = S.tabs[i];
      // A tab pinned to a commit shows a frozen diff; the working tree going
      // clean is exactly when you want to still be reading it.
      if (t.diffRef) continue;
      const code = statuses[t.path];
      const isDiff = !!code && code !== 'U';
      const wasDiff = !!(t.diffMode || t.openedInDiffView);
      if (wasDiff && (t.diffAvailable || t.diffMode) && !isDiff) {
        closeTab(i);
      }
    }
  }

  // Check if any open tabs are affected by modifications
  const anyTabModified = S.tabs.some((t) => {
    if (t.diffRef) return false; // frozen at a commit; the working tree can't move it
    const code = statuses[t.path];
    return code && code !== 'U';
  });

  if (anyTabModified) {
    // In-place reload of open tabs updates file lines, syntax highlighting, and diff view live
    await reloadOpenTabs({ onlyIfChanged: true });
  } else {
    // Synchronize open tabs' diff badges
    let tabsChanged = false;
    for (const t of S.tabs) {
      if (t.diffRef) continue;
      const code = statuses[t.path];
      const isDiff = !!code && code !== 'U';
      if (t.diffAvailable !== isDiff) {
        t.diffAvailable = isDiff;
        tabsChanged = true;
      }
    }
    if (tabsChanged) {
      drawTabs();
    }

    // Update active editor gutter and diff view if active document is affected
    const curDoc = doc_();
    if (curDoc && !curDoc.diffRef) {
      const curCode = statuses[curDoc.path];
      const hasDiff = !!curCode && curCode !== 'U';

      if (curDoc.diffAvailable !== hasDiff || curCode) {
        curDoc.diffAvailable = hasDiff;
        await loadGutter(curDoc);
        render();
        if (curDoc.diffMode) {
          syncDiffView(true);
        }
        services.updateStatus();
      }
    }
  }
}

export const refreshTree = () => editorStore.actions.refreshTree();
export const revealDir = (path) => editorStore.actions.revealDirectory(path);
export const revealFile = (path) => editorStore.actions.revealFile(path);
export const collapseAllDirs = () => editorStore.actions.collapseTree();
export const expandDirtyDirs = () => editorStore.actions.expandTree(true);
export const setSidebarMode = (...args) => editorStore.actions.setTreeMode(...args);
export const hasGitView = () => editorStore.tree.hasGitView();
export const inGitMode = () => editorStore.tree.mode() === 'git';
export const setAutoRevealSuppressed = (value) =>
  editorStore.actions.setAutoRevealSuppressed(value);
export const promptNewItem = (...args) => editorStore.actions.openNewItem(...args);

export const refreshUnpushed = (...args) => editorStore.actions.refreshUnpushed(...args);
export const syncGitPanelMeta = () => editorStore.actions.initializeGit();

export const openPalette = (...args) => editorStore.actions.openPalette(...args);
export const closePalette = () => editorStore.actions.closePalette();
export const isPaletteOpen = () => !!editorStore?.palette.state.open;
export const runSearch = () => editorStore.actions.runSearch();
export const cancelSearch = () => editorStore.actions.cancelSearch();
export const renderResults = (result) => editorStore.actions.setSearchResults(result);
export const searchWorkspace = (...args) => editorStore.actions.searchWorkspace(...args);
