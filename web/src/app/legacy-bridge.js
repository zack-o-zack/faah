import { render as renderSolid } from 'solid-js/web';
import { createComponent } from 'solid-js';
import { EditorProvider } from '../editor/context.jsx';
import { AgentPicker } from '../agents/AgentPicker.jsx';
import { apiText } from '../lib/api.js';
import { previewKind as documentPreviewKind, viewMode, canDiff } from '../viewers/view.js';
import { sanitizeMarkdown as cleanMarkdown } from '../viewers/markdown-dom.js';
// Removed when the last legacy module is migrated.
import { createSourceDOM } from '../editor/source-dom.js';
import { createEffect, createMemo, on, onCleanup } from 'solid-js';
import { linkTarget } from '../threads/references.js';
import { S, $, $$, esc } from '../state.js';
import { api, apiPost, apiPostJson } from '../lib/api.js';
export { api, apiPost, apiPostJson };
import { isMac, keyLabel, keyParts, withKeys } from '../lib/keyboard.js';
export { keyLabel, withKeys };
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
import { listThemes } from '../lib/theme.js';
import { lineText, LH } from '../editor/layout.js';
import { selectionRef, contextSnippet } from '../editor/selection.js';
export { listThemes };
let editorStore;
let themeStore;
let sourceDOM;
const services = {};
const facades = new Map();
const extras = new Map();
let rowsEl;
export function bindLegacyEditor(value, theme) {
  editorStore = value;
  themeStore = theme;
  const metadata = new Proxy(
    {},
    {
      get: (_, key) => {
        const names = {
          agents: 'harnesses',
          agent: 'selected',
          agentModel: 'model',
          agentPinned: 'pinned',
        };
        return names[key]
          ? value.agents.state[names[key]]
          : value.store.state.workspace.meta?.[key];
      },
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
  };
  for (const [name, [slice, key]] of Object.entries(mappings)) {
    Object.defineProperty(S, name, {
      configurable: true,
      get: () => value.store.state[slice][key],
      set: (next) => {
        if (slice === 'editor') value.store.actions.setGeometry({ [key]: next });
        else if (slice === 'navigation') value.store.actions.setNavigation({ [key]: next });
        else if (name === 'active') value.store.actions.activateDocument(next, { push: false });
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
  rowsEl = $('#rows');
  sourceDOM = createSourceDOM(rowsEl, doc_);
  diffview = $('#diffview');
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
  const {
    openSettings,
    showHelp,
    newThread,
    deleteCurrentThread,
    showThreadsSidebar,
    copyToClipboard,
    copyRichToClipboard,
  } = value;
  editorStore.actions.openLegacyPR = value.launchPR;
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
    { name: withKeys('Preferences: Open Settings (UI) ({Mod+,})'), run: () => openSettings('ui') },
    { name: 'Preferences: Open Settings (JSON)', run: () => openSettings('json') },
    { name: 'Threads: Show All', run: () => showThreadsSidebar() },
    {
      name: withKeys('Threads: Start New Thread ({Alt+T} on a selection)'),
      run: () => newThread(null),
    },
    { name: 'Threads: Delete Current Thread', run: deleteCurrentThread },
    { name: 'Git: Open Pull Request…', run: () => openPalette('openpr', '') },
    { name: 'Keyboard Shortcuts', run: showHelp },
  ]);
  onCleanup(releaseCommands);
  createEffect(
    on(
      () => [
        editorStore.store.state.layout.left,
        editorStore.store.state.layout.right,
        editorStore.store.state.layout.threads,
        editorStore.store.state.layout.threadsWidth,
      ],
      ([left, right, threads, width]) => {
        document.body.classList.toggle('side-hidden', !left);
        document.body.classList.toggle('right-hidden', !right);
        document.body.classList.toggle('threads-hidden', !threads);
        void width;
        $('#btn-top-threads')?.setAttribute('aria-pressed', String(threads));
      },
    ),
  );
  Object.assign(editorStore.actions, {
    openLegacySettings: value.openSettings,
    openLegacyHelp: value.showHelp,
    nudgeLegacyForgeToken: value.nudgeForgeToken,
    selectLegacyAgent: editorStore.actions.selectAgent,
    legacyAgentModels: editorStore.actions.loadAgentModels,
    async legacyHistoryChanged() {
      await editorStore.actions.reindexWorkspace();
      if (S.meta?.pr) await value.refreshPRMeta();
      await reloadOpenTabs();
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
  Object.assign(editorStore.services, {
    activate() {
      const document = doc_();
      if (!document) {
        $('#empty').hidden = false;
        syncViewers();
        return;
      }
      $('#empty').hidden = true;
      syncViewers();
      value.emit('tab:activated', { doc: document });
    },
    closed(document) {
      facades.delete(document.path);
      extras.delete(document.path);
      value.emit('tab:closed', { doc: document });
      if (!S.tabs.length) value.emit('tabs:cleared');
    },
    syncViewers,
    modKey: MOD,
    viewerWord(event, definition) {
      const word = wordAtPoint(event.clientX, event.clientY);
      if (!word) return;
      S.at = word;
      S.lastWord = word.word;
      if (definition) {
        event.preventDefault();
        editorStore.actions.gotoDefinition(word, { view: event.altKey ? 'source' : 'diff' });
      } else hoverAt(event.clientX, event.clientY);
    },
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
    selectAll,
    selectPreview,
    copy: value.copyToClipboard,
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

export const reloadOpenTabs = () => editorStore.actions.reloadOpenTabs();

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

const wordAtPoint = (x, y) => sourceDOM.wordAtPoint(x, y);

export const openFind = (seed) => editorStore.actions.openFind(seed);

const hoverAt = (x, y) => showHover(wordAtPoint(x, y), x, y);
const showHover = (...args) => editorStore.actions.showHover(...args);

export const setVimModeEnabled = (value, persist = true) =>
  editorStore.actions.setVimEnabled(value, persist);

export const showVimHelp = () => editorStore.actions.showVimHelp();

export const setTheme = (id, persist) => themeStore.setTheme(id, persist);

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

export const openLineMenu = (info, x, y) => editorStore.actions.openSelectionMenu(info, x, y);

async function selectAll() {
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
    editorStore.actions.findReferences(info.text.split(/\s+/)[0]);
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

// Phase-C consumers keep their imperative calls at this boundary.
const activeDocument = () => editorStore?.active();
const viewerActions = () => editorStore.actions;
const previewKind = (document = activeDocument()) => documentPreviewKind(document);
export const previewing = (document = activeDocument()) =>
  ['markdown', 'table'].includes(viewMode(document));
const previewLine = (line) => {
  viewerActions().requestPreviewLine(activeDocument(), line);
  editorStore.services.preview?.line(line);
};
const previewTopLine = () => editorStore.services.preview?.topLine() || 1;

const showPreviewHit = (index) => editorStore.services.preview?.showHit(index);
const clearPreviewMarks = () => editorStore.services.preview?.clearMarks();
const selectPreview = () => editorStore.services.preview?.select();
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
}
export const handleImageKey = (event) => editorStore.services.imageKey?.(event) || false;
export const exitMermaidFullscreen = () => {
  for (const exit of editorStore.services.diagramFullscreens || []) if (exit()) return true;
  return false;
};
const getDocRaw = (document) =>
  document
    ? apiText('api/raw', { path: document.path, ref: document.diffRef || '' })
    : Promise.resolve('');
export const sanitizeMarkdown = (html) => cleanMarkdown(html);
export let diffview;
export const setPRSyncHandler = (handler) => {
  editorStore.services.diffRendered = handler;
};
const syncViewers = () => editorStore.services.diffRendered?.();

export const setLayoutPref = (mode) => localStorage.setItem('faah.diffLayout', mode);
export const toggleDiff = () => {
  const document = activeDocument();
  if (!canDiff(document, editorStore.store.state.workspace.meta)) return;
  viewerActions().setDiffMode(
    document,
    document.diffMode ? 'source' : localStorage.getItem('faah.diffLayout') || 'split',
  );
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
  if (next) await editorStore.actions.stepDiffFile(document, next);
};

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

export const triggerRefresh = () => editorStore.actions.refreshWorkspace();
export const initGitStream = () => editorStore.actions.startWorkspaceStream();
export const onStream = (name, handler) =>
  editorStore.actions.subscribeWorkspaceEvent(name, handler);
export const setStreamTopic = (name, enabled) =>
  editorStore.actions.setWorkspaceTopic(name, enabled);
export const watchThread = (id) => editorStore.actions.watchWorkspaceThread(id);
export const refreshTree = () => editorStore.actions.refreshTree();

export const revealFile = (path) => editorStore.actions.revealFile(path);
export const collapseAllDirs = () => editorStore.actions.collapseTree();
export const expandDirtyDirs = () => editorStore.actions.expandTree(true);
export const setSidebarMode = (...args) => editorStore.actions.setTreeMode(...args);
export const hasGitView = () => editorStore.tree.hasGitView();
export const inGitMode = () => editorStore.tree.mode() === 'git';
export const setAutoRevealSuppressed = (value) =>
  editorStore.actions.setAutoRevealSuppressed(value);

export const refreshUnpushed = (...args) => editorStore.actions.refreshUnpushed(...args);
export const syncGitPanelMeta = () => editorStore.actions.initializeGit();

export const openPalette = (...args) => editorStore.actions.openPalette(...args);
export const closePalette = () => editorStore.actions.closePalette();
export const isPaletteOpen = () => !!editorStore?.palette.state.open;

export const showRightInspector = (tab) => editorStore.actions.showRightInspector(tab);
export const hideRightInspector = () => editorStore.actions.hideRightInspector();

export const setStatusNote = (...args) => editorStore.actions.setStatusNote(...args);
export const reindexWorkspace = () => editorStore.actions.reindexWorkspace();

export const toggleSidebar = () => editorStore.actions.togglePanel('left');
export const setThreadsPanelVisible = (visible) =>
  editorStore.actions.setPanelVisible('threads', visible);

const COPY_ICON = '<span aria-hidden="true">Copy</span>';
function thrSafeUrl(u) {
  u = u.trim();
  if (/^(?:https?|mailto):/i.test(u)) return esc(u);
  if (/^[a-zA-Z0-9_\-./]+(?::\d+(?:-\d+)?)?(?:#.*)?$/.test(u)) return esc(u);
  if (u.startsWith('#')) return esc(u);
  return '';
}

/* Set while rendering a finished explanation: only citations the server checked
   become links. Null everywhere else, which links anything path-shaped. */
let thrRefs = null;

function thrLinkAttrs(target, path, line, end) {
  const r = linkTarget(thrRefs, target, path, line, end);
  if (!r) return '';
  return (
    `data-path="${esc(r.path)}"` +
    (r.line ? ` data-line="${r.line}"` : '') +
    (r.end ? ` data-end="${r.end}"` : '')
  );
}

function thrInline(src) {
  if (!src) return '';
  const codes = [];
  // 1. Extract inline code spans first so nothing inside is formatted
  let s = src.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, q, code) => {
    const trimmed = code.trim();
    const m = /^([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+)(?::(\d+)(?:-(\d+))?)?$/.exec(trimmed);
    const attrs = m ? thrLinkAttrs(trimmed, m[1], m[2], m[3]) : '';
    if (attrs) {
      codes.push(
        `<code class="font-medium"><a href="#" class="thr-link cursor-pointer text-primary-text underline underline-offset-2 hover:text-primary" ${attrs}>${esc(trimmed)}</a></code>`,
      );
    } else {
      codes.push('<code>' + esc(trimmed) + '</code>');
    }
    return '%%PXCODE' + (codes.length - 1) + '%%';
  });

  // Escape HTML in the remaining text
  s = esc(s);

  // 2. Bold, italic, strikethrough
  s = s.replace(/(\*\*\*|___)([^\n]+?)\1/g, '<strong><em>$2</em></strong>');
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^a-zA-Z0-9])__([^\n]+?)__(?![a-zA-Z0-9])/g, '$1<strong>$2</strong>');
  s = s.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
  s = s.replace(/(^|[^a-zA-Z0-9])_([^\n]+?)_(?![a-zA-Z0-9])/g, '$1<em>$2</em>');
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // 3. Links & images (use placeholders so bare autolinks do not match inside href/src attributes)
  const links = [];
  const pushLink = (html) => {
    links.push(html);
    return '%%PXLINK' + (links.length - 1) + '%%';
  };

  // Images: ![alt](url)
  s = s.replace(/!\[([^\]]*)\]\(((?:[^()]|\([^()]*\))*)\)/g, (_, alt, url) => {
    const u = thrSafeUrl(url);
    return u ? pushLink(`<img src="${u}" alt="${esc(alt)}" class="thr-img" />`) : esc(alt);
  });

  // Links: [text](url)
  s = s.replace(/\[([^\]]+)\]\(((?:[^()]|\([^()]*\))*)\)/g, (_, text, url) => {
    const u = thrSafeUrl(url);
    if (!u) return text;
    const m = /^([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+)(?::(\d+)(?:-(\d+))?)?$/.exec(url.trim());
    if (m && !url.includes('://')) {
      const attrs = thrLinkAttrs(url.trim(), m[1], m[2], m[3]);
      return attrs
        ? pushLink(
            `<a href="#" class="thr-link cursor-pointer text-primary-text underline underline-offset-2 hover:text-primary" ${attrs}>${text}</a>`,
          )
        : text;
    }
    return pushLink(`<a href="${u}" target="_blank" rel="noopener noreferrer">${text}</a>`);
  });

  // Bare file:line in prose: e.g. "at agent.go:120"
  s = s.replace(
    /(^|[\s(])([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+):(\d+)(?:-(\d+))?(?=[\s),.;:!?]|$)/g,
    (_, prefix, path, line, end) => {
      const shown = path + ':' + line + (end ? '-' + end : '');
      const attrs = thrLinkAttrs(shown, path, line, end);
      return (
        prefix +
        (attrs
          ? pushLink(
              `<a href="#" class="thr-link cursor-pointer text-primary-text underline underline-offset-2 hover:text-primary" ${attrs}>${esc(shown)}</a>`,
            )
          : esc(shown))
      );
    },
  );

  // 4. Bracketed autolinks: <https://...>
  s = s.replace(/&lt;(https?:\/\/[^&>]+)&gt;/g, (_, url) => {
    const u = thrSafeUrl(url);
    return u ? pushLink(`<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`) : url;
  });

  // 5. Bare autolinks
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, prefix, url) => {
    let trailing = '';
    const m = /[.,:;?!]+$/.exec(url);
    if (m) {
      trailing = m[0];
      url = url.slice(0, -trailing.length);
    }
    const u = thrSafeUrl(url);
    return u
      ? `${prefix}` +
          pushLink(`<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`) +
          trailing
      : prefix + url + trailing;
  });

  // 6. Restore links & codes
  s = s.replace(/%%PXLINK(\d+)%%/g, (_, idx) => links[+idx]);
  s = s.replace(/%%PXCODE(\d+)%%/g, (_, idx) => codes[+idx]);

  return s;
}

export function thrMd(src) {
  if (!src) return '';
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let html = '';
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code block: ``` or ~~~
    const fenceMatch = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[2][0];
      const markerLen = fenceMatch[2].length;
      const rawLang = fenceMatch[3].trim().split(/\s+/)[0] || '';
      const lang = /^[\w+#.-]+$/.test(rawLang) ? rawLang : '';
      const codeLines = [];
      i++;
      while (i < lines.length) {
        const endMatch = new RegExp('^( {0,3})' + marker + '{' + markerLen + ',}\\s*$').exec(
          lines[i],
        );
        if (endMatch) {
          i++;
          break;
        }
        codeLines.push(lines[i]);
        i++;
      }
      const code = esc(codeLines.join('\n'));
      html +=
        `<div class="thr-pre"` +
        (lang ? ` data-lang="${esc(lang)}"` : '') +
        `><pre><code>` +
        code +
        `</code></pre><button title="Copy code" aria-label="Copy code" class="btn absolute top-2 right-2" data-control="thr-copy" data-variant="ghost" data-size="icon-xs">` +
        COPY_ICON +
        `</button></div>`;
      continue;
    }

    // Heading: #{1,6}
    const hMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hMatch) {
      const level = hMatch[1].length;
      html += `<h${level}>` + thrInline(hMatch[2]) + `</h${level}>`;
      i++;
      continue;
    }

    // Horizontal rule: ---, ***, ___
    if (/^( {0,3})([-*_])(?:\s*\2){2,}\s*$/.test(line)) {
      html += '<hr>';
      i++;
      continue;
    }

    // Blockquote: >
    if (/^( {0,3})>(?: (.*)|(.*))$/.test(line)) {
      const qLines = [];
      while (i < lines.length) {
        const qm = /^( {0,3})>(?: (.*)|(.*))$/.exec(lines[i]);
        if (qm) {
          qLines.push(qm[2] !== undefined ? qm[2] : qm[3] || '');
          i++;
        } else if (lines[i].trim() && !/^( {0,3})([#`~*-]|\d+\.)/.test(lines[i])) {
          qLines.push(lines[i]);
          i++;
        } else {
          break;
        }
      }
      let alertClass = '';
      let alertTitle = '';
      if (qLines.length > 0) {
        const am = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i.exec(qLines[0]);
        if (am) {
          const kind = am[1].toLowerCase();
          const titles = {
            note: 'Note',
            tip: 'Tip',
            important: 'Important',
            warning: 'Warning',
            caution: 'Caution',
          };
          const alertClasses = {
            note: 'thr-alert thr-alert-note',
            tip: 'thr-alert thr-alert-tip',
            important: 'thr-alert thr-alert-important',
            warning: 'thr-alert thr-alert-warning',
            caution: 'thr-alert thr-alert-caution',
          };
          alertClass = alertClasses[kind];
          alertTitle = `<p class="thr-alert-title">${titles[kind]}</p>`;
          qLines.shift();
        }
      }
      const inner = thrMd(qLines.join('\n'));
      html += `<blockquote class="${alertClass}">${alertTitle}${inner}</blockquote>`;
      continue;
    }

    // Table
    if (line.includes('|') && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      const isDelim = /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(nextLine);
      if (isDelim) {
        const splitRow = (r) => {
          let s = r.trim();
          if (s.startsWith('|')) s = s.slice(1);
          if (s.endsWith('|')) s = s.slice(0, -1);
          return s.split('|').map((c) => c.trim());
        };
        const headers = splitRow(line);
        const delims = splitRow(nextLine);
        const aligns = delims.map((d) => {
          const left = d.startsWith(':');
          const right = d.endsWith(':');
          if (left && right) return 'center';
          if (right) return 'right';
          if (left) return 'left';
          return '';
        });
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        let tbl = '<table><thead><tr>';
        headers.forEach((h, col) => {
          const align = aligns[col] ? ` style="text-align:${aligns[col]}"` : '';
          tbl += `<th${align}>${thrInline(h)}</th>`;
        });
        tbl += '</tr></thead><tbody>';
        rows.forEach((r) => {
          tbl += '<tr>';
          headers.forEach((_, col) => {
            const val = r[col] || '';
            const align = aligns[col] ? ` style="text-align:${aligns[col]}"` : '';
            tbl += `<td${align}>${thrInline(val)}</td>`;
          });
          tbl += '</tr>';
        });
        tbl += '</tbody></table>';
        html += tbl;
        continue;
      }
    }

    // List: unordered (*, -, +) or ordered (1.)
    const listMatch = /^( *)([-*+]|\d+[.)]) +(.*)$/.exec(line);
    if (listMatch) {
      const listStack = [];
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j++;
          if (j < lines.length && /^( *)([-*+]|\d+[.)]) +(.*)$/.test(lines[j])) {
            i++;
            continue;
          }
          break;
        }

        const itemMatch = /^( *)([-*+]|\d+[.)]) +(.*)$/.exec(l);
        if (itemMatch) {
          const indent = itemMatch[1].length;
          const marker = itemMatch[2];
          const isOrdered = /^\d/.test(marker);
          const type = isOrdered ? 'ol' : 'ul';
          let itemText = itemMatch[3];

          let taskInput = '';
          const taskMatch = /^\[([ xX])\] +(.*)$/.exec(itemText);
          if (taskMatch) {
            const checked = taskMatch[1].toLowerCase() === 'x';
            taskInput = `<input type="checkbox" disabled${checked ? ' checked' : ''} class="input"> `;
            itemText = taskMatch[2];
          }

          while (listStack.length && indent < listStack[listStack.length - 1].indent) {
            const popped = listStack.pop();
            html += `</li></${popped.type}>`;
          }

          if (!listStack.length || indent > listStack[listStack.length - 1].indent) {
            html +=
              `<${type}><li class="${taskInput ? 'thr-task-item' : ''}">` +
              taskInput +
              thrInline(itemText);
            listStack.push({ type, indent });
          } else {
            if (listStack[listStack.length - 1].type !== type) {
              const popped = listStack.pop();
              html += `</li></${popped.type}><${type}>`;
              listStack.push({ type, indent });
            } else {
              html +=
                `</li><li class="${taskInput ? 'thr-task-item' : ''}">` +
                taskInput +
                thrInline(itemText);
            }
          }
          i++;
        } else {
          const indentMatch = /^( *)/.exec(l);
          const isIndented = indentMatch[1].length > listStack[listStack.length - 1].indent;
          if (isIndented && !/^( {0,3})([`~]{3,}|#{1,6}\s|>)/.test(l)) {
            html += '<br>' + thrInline(l.trim());
            i++;
          } else if (!isIndented && !/^( {0,3})([#`~>]|[-*_]{3,})/.test(l) && !l.includes('|')) {
            html += '<br>' + thrInline(l.trim());
            i++;
          } else {
            break;
          }
        }
      }

      while (listStack.length) {
        const popped = listStack.pop();
        html += `</li></${popped.type}>`;
      }
      continue;
    }

    // Paragraph: collect lines until blank line or block start
    const pLines = [];
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) break;
      if (/^( {0,3})(`{3,}|~{3,})/.test(l)) break;
      if (/^#{1,6}\s+/.test(l)) break;
      if (/^( {0,3})([-*_])(?:\s*\2){2,}\s*$/.test(l)) break;
      if (/^( {0,3})>/.test(l)) break;
      if (/^( *)([-*+]|\d+[.)]) +/.test(l)) break;
      if (
        l.includes('|') &&
        i + 1 < lines.length &&
        /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(lines[i + 1])
      )
        break;

      pLines.push(l);
      i++;
    }
    if (pLines.length) {
      html += '<p>' + pLines.map(thrInline).join('<br>') + '</p>';
    }
  }
  return html;
}

export const setReviewMode = (mode) => editorStore.actions.setReviewMode(mode);
export const newThread = (...args) => editorStore.actions.newThread(...args);
export const openThread = (id) => editorStore.actions.openThread(id);
export const deleteCurrentThread = () => editorStore.actions.deleteThread();
export const showThreadsSidebar = () => editorStore.actions.showThreads();
export const hideThreadsSidebar = () => editorStore.actions.hideThreads();
export const initThreads = () => editorStore.actions.initializeThreads();
export const applyAgentMeta = () =>
  editorStore.actions.acceptAgentMeta(editorStore.store.state.workspace.meta);
export const loadAgentAsync = () => editorStore.actions.initializeAgents();
export const selectAgent = (...args) => editorStore.actions.selectAgent(...args);
export const loadPickerModels = (name) => editorStore.actions.loadAgentModels(name);
export const reloadWorkspace = (...args) => editorStore.actions.reloadWorkspace(...args);
export const submitBatch = () => editorStore.actions.applyAgentBatch();
const pickers = new WeakSet();
export function registerAgentPicker(root) {
  if (!root || pickers.has(root)) return;
  pickers.add(root);
  root.replaceChildren();
  const dispose = renderSolid(
    () =>
      createComponent(EditorProvider, {
        value: editorStore,
        get children() {
          return createComponent(AgentPicker, {});
        },
      }),
    root,
  );
  onCleanup(dispose);
}
