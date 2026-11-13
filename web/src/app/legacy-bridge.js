import { diffLayout } from '../settings/logic.ts';
import { apiText } from '../lib/api.js';
import { previewKind as documentPreviewKind, viewMode, canDiff } from '../viewers/view.js';
// Removed when the last legacy module is migrated.
import { createSourceDOM } from '../editor/source-dom.js';
import { createEffect, createMemo, on, onCleanup } from 'solid-js';
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
import { lineText } from '../editor/layout.js';
import { selectionRef, contextSnippet } from '../editor/selection.js';
export { listThemes };
let editorStore;
let sourceDOM;
const services = {};
const facades = new Map();
const extras = new Map();
let rowsEl;
export function bindLegacyEditor(value) {
  editorStore = value;
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
    showHelp,
    newThread,
    deleteCurrentThread,
    showThreadsSidebar,
    copyToClipboard,
    copyRichToClipboard,
  } = value;
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
      name: withKeys('Preferences: Open Settings (UI) ({Mod+,})'),
      run: () => editorStore.actions.openSettings('ui'),
    },
    {
      name: 'Preferences: Open Settings (JSON)',
      run: () => editorStore.actions.openSettings('json'),
    },
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
    openLegacyHelp: value.showHelp,
    selectLegacyAgent: editorStore.actions.selectAgent,
    legacyAgentModels: editorStore.actions.loadAgentModels,
  });
  Object.assign(editorStore.services, {
    activate() {
      const document = doc_();
      if (!document) {
        $('#empty').hidden = false;
        return;
      }
      $('#empty').hidden = true;
      value.emit('tab:activated', { doc: document });
    },
    closed(document) {
      facades.delete(document.path);
      extras.delete(document.path);
      value.emit('tab:closed', { doc: document });
      if (!S.tabs.length) value.emit('tabs:cleared');
    },
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
    showHelp: value.showHelp,
    selectAll,
    selectPreview,
    copy: value.copyToClipboard,
    blocked: () => !!$('dialog[open]') || !!$('#overlay')?.open,
    selectionAction,
  });
}
export const doc_ = () =>
  editorStore?.active() ? legacyDocument(editorStore.active().path) : null;
export const openFile = (path, options) => editorStore.actions.openFile(path, options);
export const switchTab = (index) => editorStore.actions.switchTab(index);

export const reloadOpenTabs = () => editorStore.actions.reloadOpenTabs();

export const layout = () => editorStore?.actions.refresh();
export const render = layout;

export const toggleWordWrap = (forced) => editorStore.actions.toggleWrap(forced);
export const highlightRange = (path, l1, l2) =>
  editorStore.store.actions.setNavigation({ reference: { path, l1, l2 } });

const wordAtPoint = (x, y) => sourceDOM.wordAtPoint(x, y);

export const openFind = (seed) => editorStore.actions.openFind(seed);

const hoverAt = (x, y) => showHover(wordAtPoint(x, y), x, y);
const showHover = (...args) => editorStore.actions.showHover(...args);

export const showVimHelp = () => editorStore.actions.showVimHelp();

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

export const toggleDiff = () => {
  const document = activeDocument();
  if (!canDiff(document, editorStore.store.state.workspace.meta)) return;
  viewerActions().setDiffMode(
    document,
    document.diffMode ? 'source' : diffLayout(editorStore.settings.preferences()),
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

export const setReviewMode = (mode) => editorStore.actions.setReviewMode(mode);
export const initializePR = () => editorStore.actions.initializePR();
export const loadSettings = () => editorStore.actions.loadSettings();
export const openSettings = (...args) => editorStore.actions.openSettings(...args);
export const closeSettings = () => editorStore.actions.closeSettings();
export const isSettingsOpen = () => editorStore.settings.state.dialog.open;
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
