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
import { wordAtColumn } from '../editor/cursor.js';
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
  wordAtColumn,
};
let editorStore;
let themeStore;
let symbols;
let sourceDOM;
let hoverTimer;
const services = {};
const facades = new Map();
const extras = new Map();
export let vp, sizer, rowsEl, editor, editTextarea, hovercard, findbar, findInput;
export function bindLegacyEditor(value, theme) {
  editorStore = value;
  themeStore = theme;
  symbols = createSymbolActions(value.store, {
    onChange: () => services.drawOutline?.(),
    acceptLsp: (value) => services.setLspState?.(value),
  });
  onCleanup(symbols.dispose);
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
            preview: !!services.previewing?.(),
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
  hovercard = $('#hovercard');
  findbar = $('#findbar');
  findInput = $('#find-input');
  sourceDOM = createSourceDOM(rowsEl, doc_);
  const selected = () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (vp.contains(range.commonAncestorContainer)) return;
    editorStore.actions.setSelection(viewerSelection(range, doc_()));
  };
  document.addEventListener('selectionchange', selected);
  onCleanup(() => {
    document.removeEventListener('selectionchange', selected);
    clearTimeout(hoverTimer);
  });
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
        if (
          [
            'mdHtml',
            'mdError',
            'rawText',
            'diffText',
            'gutter',
            'diffHunks',
            'prDiffHunks',
            'yourDiffHunks',
            'fullFileLines',
            'fullFileRaw',
            'tableData',
            'imageMeta',
            'mdReq',
            'rawTextPromise',
            'diffReq',
          ].includes(key)
        ) {
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
  value.setSourceJumpHandler(jumpToSourceLine);
  value.setCommitStepHandler(async (from, file) => {
    const { diffRef: ref, diffBase: base, turnFiles, turnLabel } = from;
    await openFile(file.path, { ref, base, turnFiles, turnLabel, view: 'diff' });
    const index = S.tabs.indexOf(from);
    if (index >= 0 && from !== doc_() && from.diffRef === ref) closeTab(index);
  });
  Object.assign(editorStore.services, {
    activate() {
      const document = doc_();
      if (!document) {
        $('#empty').hidden = false;
        value.syncViewers();
        value.updateStatus();
        return;
      }
      $('#empty').hidden = true;
      S.lsp = document.lsp || { state: 'off', server: '' };
      value.syncViewers();
      value.warmLSP(document);
      void symbols.load(document.path).catch(() => {});
      void loadGutter(document);
      value.updateStatus();
      value.emit('tab:activated', { doc: document });
    },
    closed(document) {
      symbols.cancel(document.path);
      facades.delete(document.path);
      extras.delete(document.path);
      value.emit('tab:closed', { doc: document });
      if (!S.tabs.length) value.emit('tabs:cleared');
    },
    syncViewers: value.syncViewers,
    loadGutter: (path) => loadGutter(legacyDocument(path)),
    saved: value.triggerRefresh,
    previewing: value.previewing,
    previewLine: value.previewLine,
    findPreview(query, cs) {
      return new Array(value.findInPreview(query, cs)).fill(null);
    },
    showPreviewHit: value.showPreviewHit,
    clearPreviewMarks: value.clearPreviewMarks,
    hoverAllowed: () =>
      S.settings?.['lsp.hover.enabled'] !== false &&
      S.settings?.['lsp.enabled'] !== false &&
      ['ready', 'indexing'].includes(S.lsp.state),
    showHelp: value.showHelp,
    vimPreference: (enabled) => {
      S.settings['editor.vimMode'] = enabled;
    },
    previewTopLine: value.previewTopLine,
    definition(at, options) {
      const document = editorStore.active();
      if (document) editorStore.store.actions.pushHistory(document.path, document.cur);
      return value.gotoDefinition(at || editorStore.actions.wordAtCaret(), options);
    },
    selectAll,
    selectPreview: value.selectPreview,
    references: (at) => value.findReferences(at || editorStore.actions.wordAtCaret()),
    calls: (at) => value.showCalls(at || editorStore.actions.wordAtCaret()),
    lspState: value.setLspState,
    copy: value.copyToClipboard,
    palette: () => value.openPalette('command'),
    beforeUnload: value.beforeUnload,
    blocked: () => !!$('dialog[open]') || !!$('#overlay')?.open,
    viewerSelection: viewerSelection,
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
  const document = doc_();
  if (document) document.diffMode = null;
  editorStore.actions.patch({ cur: line });
  editorStore.actions.centerLine(line);
  services.syncViewers?.();
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

export const rowFor = (line) => sourceDOM.rowFor(line);
export const toPos = (node, offset) => sourceDOM.toPos(node, offset);
export const toPoint = (point) => sourceDOM.toPoint(point);
export const lineTopY = (line) => editorStore.offsets()[Math.max(0, line - 1)] || 0;

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
export const showVimHelp = () => editorStore.setUI('vimHelp', true);

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

export const closeSelMenu = () => editorStore.setUI('menu', null);
export const openLineMenu = (info, x, y) => editorStore.setUI('menu', { info, x, y });
export const runSelectionAction = (action, trigger, override) =>
  editorStore.actions.runSelectionAction(action, trigger, override);

export async function selectAll() {
  const document = doc_();
  if (!document) return;
  const text = await services.getDocRaw(document);
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
      services
        .getDocRaw(doc_())
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
    document.diffAvailable = !!(result.available || document.diffBase);
    if (
      document.diffAvailable &&
      !document.diffMode &&
      !document.diffDismissed &&
      document.openedInDiffView
    ) {
      document.diffMode = localStorage.getItem('faah.diffLayout') || 'split';
      if (doc_() === document) services.syncViewers?.();
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
export async function loadOutline() {
  const document = doc_();
  if (!document) return;
  try {
    await symbols.load(document.path);
    await symbols.upgrade(document.path);
  } catch {
    /* A closing workspace can drop symbol requests. */
  }
}

export function markNodes(el, needle, caseSensitive, cls) {
  if (!el || !needle) return [];
  const out = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const texts = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n);
  for (const node of texts) {
    const raw = node.nodeValue;
    const hay = caseSensitive ? raw : raw.toLowerCase();
    const nd = caseSensitive ? needle : needle.toLowerCase();
    let i = hay.indexOf(nd),
      at = 0;
    if (i < 0) continue;
    const frag = document.createDocumentFragment();
    while (i >= 0) {
      if (i > at) frag.appendChild(document.createTextNode(raw.slice(at, i)));
      const mk = document.createElement(cls === 'mark' ? 'mark' : 'span');
      if (cls !== 'mark') mk.className = cls;
      mk.textContent = raw.slice(i, i + nd.length);
      frag.appendChild(mk);
      out.push(mk);
      at = i + nd.length;
      i = hay.indexOf(nd, at);
    }
    if (at < raw.length) frag.appendChild(document.createTextNode(raw.slice(at)));
    node.parentNode.replaceChild(frag, node);
  }
  return out;
}

function extractMarkdownSelection(range, d) {
  const frag = range.cloneContents();
  const text = getFragmentPlainText(frag).trim();
  if (!text) return null;

  const html = getFragmentHtml(frag);
  const rawMarkdown = domToMarkdown(frag).trim();
  const { l1, l2 } = getMarkdownRangeLines(range);

  return {
    text,
    html,
    rawMarkdown,
    l1: l1 || 1,
    l2: l2 || d.total || 1,
    path: d.path,
    isMarkdownPreview: true,
  };
}

function clipToRange(el, range) {
  const r = document.createRange();
  r.selectNodeContents(el);
  if (range.compareBoundaryPoints(Range.START_TO_START, r) > 0)
    r.setStart(range.startContainer, range.startOffset);
  if (range.compareBoundaryPoints(Range.END_TO_END, r) < 0)
    r.setEnd(range.endContainer, range.endOffset);
  return r.toString();
}

/* A diff selection is anchored to the working-tree lines stamped on its rows,
   on either side of a split. A selection of deleted lines alone has nothing on
   disk, so it is anchored to the lines either side of where they were. The text
   is gathered from the code cells alone, leaving out the line-number and +/-
   gutters a raw selection would otherwise sweep up, and a context line showing
   on both sides of a split is taken once. */
function diffSelection(range, d) {
  let l1 = Infinity,
    l2 = -Infinity,
    at1 = Infinity,
    at2 = -Infinity;
  let old1 = Infinity,
    old2 = -Infinity;
  const parts = [];
  const seen = new Set();
  for (const el of $('#diffview').querySelectorAll('[data-l], [data-at], [data-old-l]')) {
    if (!range.intersectsNode(el)) continue;
    const code = el.querySelector('.diff-code');
    if (el.dataset.l !== undefined) {
      const n = +el.dataset.l;
      if (n < l1) l1 = n;
      if (n > l2) l2 = n;
      if (seen.has(n)) continue;
      seen.add(n);
    } else if (el.dataset.at !== undefined) {
      const n = +el.dataset.at;
      if (n < at1) at1 = n;
      if (n > at2) at2 = n;
    }
    if (el.dataset.oldL !== undefined && el.dataset.l === undefined) {
      const n = +el.dataset.oldL;
      if (n < old1) old1 = n;
      if (n > old2) old2 = n;
    }
    parts.push(code ? clipToRange(code, range) : '');
  }
  if (!parts.length) return null;
  const isDeletedOnly = l1 === Infinity;
  let side = 'RIGHT';
  let delL1 = 0,
    delL2 = 0;
  if (isDeletedOnly) {
    side = 'LEFT';
    delL1 = old1 !== Infinity ? old1 : 1;
    delL2 = old2 !== Infinity ? old2 : delL1;
    const last = Math.max(1, d.total || 1);
    l1 = Math.min(last, Math.max(1, at1 - 1));
    l2 = Math.max(l1, Math.min(last, at2));
  }
  const text = parts.join('\n');
  if (!text) return null;
  return { text, l1, l2, delL1, delL2, path: d.path, fromDiff: true, side };
}

const domToMarkdown = (...args) => services.domToMarkdown(...args);
const getFragmentPlainText = (...args) => services.getFragmentPlainText(...args);
const getFragmentHtml = (...args) => services.getFragmentHtml(...args);
const getMarkdownRangeLines = (...args) => services.getMarkdownRangeLines(...args);
function viewerSelection(range, document) {
  const md = $('#mdview');
  const diff = $('#diffview');
  if (md && !md.hidden && md.contains(range.commonAncestorContainer))
    return extractMarkdownSelection(range, document);
  if (diff && !diff.hidden && diff.contains(range.commonAncestorContainer))
    return diffSelection(range, document);
  return null;
}

export const drawOutline = () => services.drawOutline?.();
