import { batch, createSignal } from 'solid-js';
import { reconcile } from 'solid-js/store';
import { createDocumentBuffer } from './buffer.js';
import { CHUNK } from './layout.js';

/**
 * @typedef {Object} DocTab
 * @property {string} path
 * @property {string} name
 * @property {string} lang
 * @property {number} total
 * @property {number} cur
 * @property {number} col
 * @property {number} scrollTop
 * @property {boolean} dirty
 * @property {boolean} isEditing
 * @property {string|null} diffMode
 * @property {{line:number,col:number}|null} selAnchor
 */
export function createDocuments(
  state,
  set,
  { fetcher, onActivate = () => {}, onClose = () => {} } = {},
) {
  const buffers = new Map();
  const [bufferRevision, bumpBuffers] = createSignal(0);
  const closed = [];
  const opening = new Map();
  const indexOf = (path) => state.documents.tabs.findIndex((tab) => tab.path === path);
  function patchDocument(path, patch) {
    const index = indexOf(path);
    if (index >= 0) set('documents', 'tabs', index, patch);
  }
  function createBuffer(path, ref) {
    const buffer = createDocumentBuffer(path, {
      fetcher,
      ref,
      onMetadata(result) {
        const { total, maxCols, size, lang, diagnostics } = result;
        patchDocument(path, { total, maxCols, size, lang, diagnostics: diagnostics || [] });
      },
    });
    buffers.set(path, buffer);
    bumpBuffers((value) => value + 1);
    return buffer;
  }
  function pushHistory(path, line) {
    const { history, historyIndex } = state.documents;
    const last = history[historyIndex];
    if (last?.path === path && Math.abs(last.line - line) < 2) return;
    const next = [...history.slice(0, historyIndex + 1), { path, line }].slice(-120);
    set('documents', { history: next, historyIndex: next.length - 1 });
  }
  function activateDocument(index, { push = true } = {}) {
    if (!state.documents.tabs[index]) return;
    set('documents', 'active', index);
    const document = state.documents.tabs[index];
    if (push) pushHistory(document.path, document.cur);
    onActivate(document);
  }
  async function openDocument(path, options = {}) {
    if (opening.has(path)) await opening.get(path);
    let index = indexOf(path);
    const ref = options.ref || '';
    if (index < 0) {
      const buffer = createBuffer(path, ref);
      const chunk = Math.floor(Math.max(0, (options.line || 1) - 1) / CHUNK);
      const promise = buffer.loadChunk(chunk);
      opening.set(path, promise);
      let result;
      try {
        result = await promise;
      } catch (error) {
        buffer.dispose();
        buffers.delete(path);
        throw error;
      } finally {
        opening.delete(path);
      }
      if (!result) return;
      const hasDiff = !result.image && (result.diffAvailable || options.base);
      const layout = options.layout || 'split';
      const diffMode = hasDiff && (options.view !== 'source' || result.deleted) ? layout : null;
      const document = {
        path,
        name: path.split('/').pop(),
        lang: result.image ? 'image' : result.lang,
        total: result.total || 0,
        maxCols: result.maxCols || 0,
        size: result.size || 0,
        cur: options.line || 1,
        col: options.col || 0,
        selAnchor: null,
        scrollTop: 0,
        dirty: false,
        isEditing: false,
        markdown: !!result.markdown,
        table: !!result.table,
        isImage: !!result.image,
        deleted: !!result.deleted,
        lsp: result.lsp || { state: 'off', server: '' },
        diagnostics: result.diagnostics || [],
        diffMode,
        diffAvailable: !!hasDiff,
        diffDismissed: options.view === 'source',
        openedInDiffView: !!diffMode,
        diffRef: ref,
        diffBase: options.base || '',
        turnFiles: options.turnFiles || null,
        turnLabel: options.turnLabel || '',
        outline: null,
        gutter: null,
      };
      batch(() => {
        set('documents', 'tabs', state.documents.tabs.length, document);
        index = indexOf(path);
        if (options.activate !== false) activateDocument(index, { push: options.push !== false });
      });
      return state.documents.tabs[index];
    } else {
      const document = state.documents.tabs[index];
      if ((document.diffRef || '') !== ref || (document.diffBase || '') !== (options.base || '')) {
        buffers.get(path)?.dispose();
        const result = await createBuffer(path, ref).loadChunk(0);
        const available = !!(result?.diffAvailable || options.base);
        patchDocument(path, {
          diffRef: ref,
          diffBase: options.base || '',
          diffAvailable: available,
          diffDismissed: options.view === 'source',
          diffMode: available && options.view !== 'source' ? options.layout || 'split' : null,
          openedInDiffView: available && options.view !== 'source',
          isEditing: false,
          outline: null,
        });
      }
      if (options.line) patchDocument(path, { cur: options.line, col: options.col || 0 });
      if (options.turnFiles || options.turnLabel)
        patchDocument(path, { turnFiles: options.turnFiles, turnLabel: options.turnLabel });
      if (options.view === 'source' && !document.deleted)
        patchDocument(path, { diffMode: null, diffDismissed: true, openedInDiffView: false });
      if (options.view === 'diff' && document.diffAvailable)
        patchDocument(path, {
          diffMode: options.layout || 'split',
          diffDismissed: false,
          openedInDiffView: true,
          isEditing: false,
        });
    }
    if (options.activate !== false) activateDocument(index, { push: options.push !== false });
    return state.documents.tabs[index];
  }
  function closeDocuments(indices) {
    return batch(() => {
      const targets = new Set(indices);
      const active = state.documents.tabs[state.documents.active];
      const removed = state.documents.tabs.filter((_, index) => targets.has(index));
      for (const document of removed) {
        closed.push({ path: document.path, line: document.cur });
        if (closed.length > 20) closed.shift();
        buffers.get(document.path)?.dispose();
        buffers.delete(document.path);
        bumpBuffers((value) => value + 1);
        onClose(document);
      }
      const tabs = state.documents.tabs.filter((_, index) => !targets.has(index));
      set('documents', 'tabs', reconcile(tabs, { key: 'path' }));
      const next = tabs.findIndex((document) => document.path === active?.path);
      const fallback = Math.min(state.documents.active, tabs.length - 1);
      set('documents', 'active', next >= 0 ? next : fallback);
      if (tabs.length) onActivate(tabs[state.documents.active]);
      return removed;
    });
  }
  return {
    buffers,
    bufferRevision,
    patchDocument,
    openDocument,
    activateDocument,
    closeDocuments,
    pushHistory,
    closeDocument: (index) => closeDocuments([index]),
    closeOthers(index) {
      activateDocument(index);
      return closeDocuments(state.documents.tabs.map((_, at) => at).filter((at) => at !== index));
    },
    moveDocument(from, to) {
      const tabs = [...state.documents.tabs];
      const activePath = tabs[state.documents.active]?.path;
      const [document] = tabs.splice(from, 1);
      if (!document) return;
      tabs.splice(Math.max(0, Math.min(to, tabs.length)), 0, document);
      set('documents', 'tabs', reconcile(tabs, { key: 'path' }));
      set(
        'documents',
        'active',
        state.documents.tabs.findIndex((tab) => tab.path === activePath),
      );
    },
    async historyGo(delta) {
      const index = state.documents.historyIndex + delta;
      const item = state.documents.history[index];
      if (!item) return;
      set('documents', 'historyIndex', index);
      await openDocument(item.path, { line: item.line, push: false });
    },
    reopenDocument() {
      while (closed.length) {
        const item = closed.pop();
        if (indexOf(item.path) < 0) return openDocument(item.path, { line: item.line });
      }
    },
    disposeDocuments() {
      for (const buffer of buffers.values()) buffer.dispose();
      buffers.clear();
    },
  };
}
