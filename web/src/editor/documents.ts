import type { SetStoreFunction } from 'solid-js/store';
import type { AppState } from '../app/store.ts';
import type { Preferences } from '../settings/logic.ts';
import type { Request } from '../lib/api.ts';
import type { DocumentBuffer } from './buffer.ts';
import type { DocTab, OpenOptions } from './types.ts';
export type { DocTab } from './types.ts';
import { initialImage, previewKind } from '../viewers/view.ts';
import { batch, createSignal } from 'solid-js';
import { reconcile } from 'solid-js/store';
import { createDocumentBuffer } from './buffer.ts';
import { CHUNK } from './layout.ts';

export function createDocuments(
  ...args: Parameters<typeof buildDocuments>
): ReturnType<typeof buildDocuments> {
  return buildDocuments(...args);
}
function buildDocuments(
  state: AppState,
  set: SetStoreFunction<AppState>,
  {
    fetcher,
    onActivate = () => {},
    onClose = () => {},
    preferences,
  }: {
    fetcher?: Request;
    onActivate?: (doc: DocTab) => void;
    onClose?: (doc: DocTab) => void;
    preferences: () => Preferences;
  },
) {
  const buffers = new Map<string, DocumentBuffer>();
  const [bufferRevision, bumpBuffers] = createSignal(0);
  const closed: { path: string; line: number }[] = [];
  const opening = new Map<string, Promise<unknown>>();
  const indexOf = (path: string) => state.documents.tabs.findIndex((tab) => tab.path === path);
  function patchDocument(path: string, patch: Partial<DocTab>) {
    const index = indexOf(path);
    if (index >= 0) set('documents', 'tabs', index, patch);
  }
  function createBuffer(path: string, ref: string) {
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
  function pushHistory(path: string, line: number) {
    const { history, historyIndex } = state.documents;
    const last = history[historyIndex];
    if (last?.path === path && Math.abs(last.line - line) < 2) return;
    const next = [...history.slice(0, historyIndex + 1), { path, line }].slice(-120);
    set('documents', { history: next, historyIndex: next.length - 1 });
  }
  function activateDocument(index: number, { push = true } = {}) {
    if (!state.documents.tabs[index]) return;
    set('documents', 'active', index);
    const document = state.documents.tabs[index];
    if (!document) return;
    if (push) pushHistory(document.path, document.cur);
    onActivate(document);
  }
  async function openDocument(
    path: string,
    options: OpenOptions = {},
  ): Promise<DocTab | undefined> {
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
      const layout = options.layout || (preferences().splitDiff ? 'split' : 'unified');
      const diffMode = hasDiff && (options.view !== 'source' || result.deleted) ? layout : null;
      const document: DocTab = {
        path,
        name: path.split('/').pop() || '',
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
        isImage: !!result.image,
        deleted: !!result.deleted,
        lsp: result.lsp || { state: 'off', server: '' },
        diagnostics: result.diagnostics || [],
        view: result.image ? 'image' : previewKind({ path, lang: result.lang }) || 'source',
        image: initialImage(),
        viewerRevision: 0,
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
      if (options.view === 'source') document.view = 'source';
      const kind = previewKind(document);
      if (
        (kind === 'markdown' && !preferences().markdownPreview) ||
        (kind === 'table' && !preferences().tablePreview)
      )
        document.view = 'source';
      batch(() => {
        set('documents', 'tabs', state.documents.tabs.length, document);
        index = indexOf(path);
        if (options.activate !== false) activateDocument(index, { push: options.push !== false });
      });
      return state.documents.tabs[index];
    } else {
      const document = state.documents.tabs[index];
      if (!document) return;
      if ((document.diffRef || '') !== ref || (document.diffBase || '') !== (options.base || '')) {
        buffers.get(path)?.dispose();
        const result = await createBuffer(path, ref).loadChunk(0);
        const available = !!(result?.diffAvailable || options.base);
        patchDocument(path, {
          viewerRevision: (document.viewerRevision || 0) + 1,
          diffRef: ref,
          diffBase: options.base || '',
          diffAvailable: available,
          diffDismissed: options.view === 'source',
          diffMode: available && options.view !== 'source' ? options.layout || 'split' : null,
          openedInDiffView: available && options.view !== 'source',
          isEditing: false,
          outline: null,
          gutterLoaded: false,
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
  function closeDocuments(indices: number[]) {
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
      const nextDocument = tabs[state.documents.active];
      if (nextDocument) onActivate(nextDocument);
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
    closeDocument: (index: number) => closeDocuments([index]),
    closeOthers(index: number) {
      activateDocument(index);
      return closeDocuments(state.documents.tabs.map((_, at) => at).filter((at) => at !== index));
    },
    moveDocument(from: number, to: number) {
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
    async historyGo(delta: number) {
      const index = state.documents.historyIndex + delta;
      const item = state.documents.history[index];
      if (!item) return;
      set('documents', 'historyIndex', index);
      await openDocument(item.path, { line: item.line, push: false });
    },
    reopenDocument() {
      while (closed.length) {
        const item = closed.pop();
        if (item && indexOf(item.path) < 0) return openDocument(item.path, { line: item.line });
      }
    },
    disposeDocuments() {
      for (const buffer of buffers.values()) buffer.dispose();
      buffers.clear();
    },
  };
}
