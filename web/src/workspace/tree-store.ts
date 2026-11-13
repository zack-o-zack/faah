import type { OpenOptions } from '../editor/types.ts';
import type { AppState } from '../app/store.ts';
import type { DocTab } from '../editor/documents.ts';
import type { Request } from '../lib/api.ts';
import type { TreeEntry } from './decode.ts';
import { decodeTree, decodeNewItem } from './decode.ts';
import { errorMessage, isAbort, isRecord } from '../lib/decode.ts';
interface TreeState {
  mode: string;
  scope: string;
  revision: number;
  busy: boolean;
  error: string;
  suppressed: boolean;
  reveal: { path: string; sequence: number };
  staging: Record<string, { staged: boolean }>;
  newItem: { type: string; path: string; pending: boolean; error: string } | null;
}
interface TreeHost {
  state: AppState;
  activeDocument: () => DocTab | null;
  settings: { preferences: () => { autoReveal: boolean } };
  actions: {
    focusScope: (document: DocTab, scope: string) => void;
    acceptGitSnapshot: (snapshot: unknown) => void;
    refreshWorkspace: () => Promise<void>;
    setPanelVisible: (name: 'left', visible: boolean) => void;
  };
}
interface TreeOptions {
  request?: Request;
  post?: Request;
  openFile?: (path: string, options?: OpenOptions) => Promise<unknown>;
  enterEditMode?: () => void | Promise<unknown>;
}
import { batch, createMemo, onCleanup } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { api, apiPostJson } from '../lib/api.ts';
import { toast } from '../lib/toast.tsx';
import { createTreeModel } from './tree-model.ts';
import { copyPath, newItemRequest, parentPath, treeDecoration } from './tree-logic.ts';

function initialState(): TreeState {
  return {
    mode: 'files',
    scope: 'all',
    revision: 0,
    busy: false,
    error: '',
    suppressed: true,
    reveal: { path: '', sequence: 0 },
    staging: {},
    newItem: null,
  };
}
export function createTreeStore(
  app: TreeHost,
  options: TreeOptions = {},
): ReturnType<typeof buildTreeStore> {
  return buildTreeStore(app, options);
}
function buildTreeStore(app: TreeHost, options: TreeOptions = {}) {
  const request = options.request || api;
  const post = options.post || apiPostJson;
  const model = createTreeModel();
  const [state, set] = createStore(initialState());
  const pending = new Map<
    string,
    { controller: AbortController; promise: Promise<boolean> | null }
  >();
  const stagingRequests = new Map<string, AbortController>();
  let generation = 0;
  let intent = 0;
  let disposed = false;
  let loadedView = '';
  let signature = '';
  let itemRequest: AbortController | undefined;
  const hasGitView = () =>
    !!(
      app.state.workspace.meta?.git &&
      (app.state.workspace.meta.gitChanges ||
        app.state.git.unpushedCount ||
        app.state.workspace.meta.pr)
    );
  const mode = () => (state.mode === 'git' && hasGitView() ? 'git' : 'files');
  const counts = createMemo(() => ({
    all: Object.keys(app.state.git.snapshot?.statuses || app.state.workspace.meta?.pr?.files || {})
      .length,
    yours: Object.keys(app.state.git.snapshot?.yourStatuses || {}).length,
  }));
  const scope = () => (state.scope === 'yours' && counts().yours > 0 ? 'yours' : 'all');
  const view = () => (mode() === 'files' ? 'all' : 'changed');
  const compact = () => (mode() === 'git' && scope() === 'yours' ? 'yours' : view());
  const rows = createMemo(() => {
    void state.revision;
    const snapshot = app.state.git.snapshot;
    void app.state.git.revision;
    return model.flatten(mode() === 'git' && scope() === 'yours' ? 'yours' : view(), snapshot);
  });
  const publish = () => set('revision', (value) => value + 1);
  function cancel() {
    generation++;
    for (const operation of pending.values()) operation.controller.abort();
    pending.clear();
  }
  async function load(dir: string, version = generation): Promise<boolean> {
    if (disposed || version !== generation) return false;
    if (model.children.has(dir)) return true;
    if (pending.has(dir)) return pending.get(dir)?.promise || false;
    const controller = new AbortController();
    const operation: { controller: AbortController; promise: Promise<boolean> | null } = {
      controller,
      promise: null,
    };
    pending.set(dir, operation);
    operation.promise = (async () => {
      try {
        const data = decodeTree(
          await request('api/tree', { dir, compact: compact() }, { signal: controller.signal }),
        );
        if (disposed || version !== generation) return false;
        model.apply(dir, data.children || []);
        return true;
      } finally {
        if (pending.get(dir) === operation) pending.delete(dir);
      }
    })();
    return operation.promise;
  }
  async function expandPath(path: string) {
    await load('');
    const version = generation;
    for (const part of path
      .split('/')
      .map((_, index, parts) => parts.slice(0, index + 1).join('/'))) {
      if (disposed || version !== generation) return;
      if (!model.entry(part)?.dir) continue;
      if (await load(part, version)) model.expand(part);
    }
    publish();
  }
  function target(path: string) {
    set('reveal', { path, sequence: state.reveal.sequence + 1 });
  }
  async function revealFile(path: string) {
    if (!path) return;
    const current = ++intent;
    set('busy', false);
    await expandPath(parentPath(path));
    if (!disposed && current === intent) target(path);
  }
  async function revealDirectory(path: string) {
    intent++;
    set('busy', false);
    await expandPath(path);
    if (!disposed) target(path);
  }
  async function expandLoaded(path: string, current: number) {
    if (await load(path)) {
      if (current === intent) model.expand(path);
    }
  }
  async function expandTree(dirtyOnly = mode() === 'git') {
    if (state.busy) return;
    const current = ++intent;
    set({ busy: true, error: '' });
    const seen = new Set<string>();
    try {
      await load('');
      while (!disposed && current === intent) {
        const filter = dirtyOnly ? scope() : 'all';
        const next = model
          .expandable(filter === 'all' && dirtyOnly ? 'changed' : filter, app.state.git.snapshot)
          .filter((row) => !seen.has(row.path))
          .slice(0, 8);
        if (!next.length) break;
        const operations = [];
        for (const row of next) {
          const path = row.path;
          seen.add(path);
          operations.push(expandLoaded(path, current));
        }
        await Promise.all(operations);
        publish();
      }
    } catch (error) {
      if (!isAbort(error) && !disposed) set('error', errorMessage(error));
    } finally {
      if (!disposed && current === intent) set('busy', false);
    }
  }
  async function refreshTree() {
    const open = [...model.expanded];
    intent++;
    cancel();
    const version = generation;
    model.clear();
    loadedView = compact();
    set({ busy: false, error: '' });
    set('reveal', 'path', '');
    publish();
    try {
      await load('', version);
      if (disposed || version !== generation) return;
      publish();
      for (const path of open.sort((a, b) => a.length - b.length)) {
        if (version !== generation) return;
        await expandPath(path);
      }
    } catch (error) {
      if (!disposed && !isAbort(error)) set('error', errorMessage(error));
    }
  }
  async function reconcileTreeSnapshot() {
    const snapshot = app.state.git.snapshot;
    const next = JSON.stringify([
      Object.keys(snapshot?.statuses || {}).sort(),
      Object.keys(snapshot?.yourStatuses || {}).sort(),
    ]);
    let refresh = loadedView !== compact();
    if (next !== signature) {
      if (mode() === 'git') refresh = true;
      else
        for (const path of Object.keys(snapshot?.statuses || {})) {
          if (!model.entry(path) && model.children.has(parentPath(path))) refresh = true;
        }
    }
    signature = next;
    if (refresh) {
      await refreshTree();
      if (mode() === 'git') await expandTree(true);
    }
  }
  async function setTreeMode(value: string, { expandDirty = true } = {}) {
    set('mode', value === 'git' ? 'git' : 'files');
    if (loadedView !== compact()) await refreshTree();
    if (mode() === 'git' && expandDirty) await expandTree(true);
  }
  async function setTreeScope(value: string) {
    set('scope', value === 'yours' ? 'yours' : 'all');
    await refreshTree();
    if (mode() === 'git') await expandTree(true);
    focusScope(app.activeDocument());
  }
  function focusScope(document: DocTab | null) {
    if (!document || !app.state.workspace.meta?.pr) return;
    app.actions.focusScope(document, scope() === 'yours' ? 'yours' : 'pr');
  }
  async function openTreeFile(path: string) {
    await options.openFile?.(path);
    focusScope(app.activeDocument());
  }
  async function stageTreeFile(path: string, staged: boolean) {
    stagingRequests.get(path)?.abort();
    const controller = new AbortController();
    stagingRequests.set(path, controller);
    set('staging', path, { staged });
    try {
      const snapshot = await post(
        staged ? 'api/git/stage' : 'api/git/unstage',
        { path },
        { signal: controller.signal },
      );
      if (disposed || controller.signal.aborted) return;
      if (isRecord(snapshot) && snapshot.git !== undefined) app.actions.acceptGitSnapshot(snapshot);
      else await app.actions.refreshWorkspace();
    } catch (error) {
      if (disposed || controller.signal.aborted) return;
      set('error', errorMessage(error));
      toast('error', errorMessage(error));
    } finally {
      if (stagingRequests.get(path) === controller && !disposed) {
        stagingRequests.delete(path);
        set(
          produce((draft) => {
            delete draft.staging[path];
          }),
        );
      }
    }
  }
  function closeNewItem() {
    itemRequest?.abort();
    set('newItem', null);
  }
  async function createItem() {
    if (!state.newItem || state.newItem.pending) return;
    itemRequest = new AbortController();
    const mine = itemRequest;
    set('newItem', { pending: true, error: '' });
    try {
      const shape = newItemRequest(state.newItem.path, state.newItem.type);
      const result = decodeNewItem(await post('api/fs/new', shape, { signal: mine.signal }));
      if (disposed || mine.signal.aborted) return;
      set('newItem', null);
      await refreshTree();
      await revealDirectory(parentPath(result.path));
      void app.actions.refreshWorkspace();
      if (shape.type === 'file') {
        await options.openFile?.(result.path);
        await options.enterEditMode?.();
      }
      toast('success', 'Created ' + result.path);
    } catch (error) {
      if (!disposed && !mine.signal.aborted && state.newItem)
        set('newItem', { pending: false, error: errorMessage(error) });
    }
  }
  onCleanup(() => {
    disposed = true;
    cancel();
    itemRequest?.abort();
    for (const controller of stagingRequests.values()) controller.abort();
    stagingRequests.clear();
    model.clear();
  });
  return {
    state,
    rows,
    mode,
    scope,
    counts,
    hasGitView,
    expanded(path: string) {
      void state.revision;
      return model.expanded.has(path);
    },
    decoration: (row: TreeEntry) =>
      treeDecoration(
        row,
        app.state.git.snapshot,
        app.state.workspace.meta?.pr,
        scope(),
        !!app.state.viewers.viewed[row.path],
        state.staging[row.path],
      ),
    autoReveal: () => !state.suppressed && app.settings.preferences().autoReveal,
    actions: {
      refreshTree,
      async openLink(path: string, openOptions?: OpenOptions) {
        try {
          const clean = path.replace(/\/+$/, '');
          const result = decodeTree(await request('api/tree', { dir: parentPath(clean) }));
          if (disposed) return;
          if (!clean || result.children.some((entry) => entry.path === clean && entry.dir)) {
            app.actions.setPanelVisible('left', true);
            await setTreeMode('files');
            await revealDirectory(clean);
            return;
          }
        } catch {
          // The document action reports a missing path or closing workspace.
        }
        if (!disposed) return options.openFile?.(path, openOptions);
      },
      revealFile,
      revealDirectory,
      expandTree,
      setTreeMode,
      setTreeScope,
      reconcileTreeSnapshot,
      openTreeFile,
      stageTreeFile,
      focusTreeScope: focusScope,
      async toggleTreeDirectory(path: string) {
        intent++;
        set('busy', false);
        if (model.expanded.has(path)) model.collapse(path);
        else {
          try {
            if (await load(path)) model.expand(path);
          } catch (error) {
            if (!isAbort(error)) set('error', errorMessage(error));
          }
        }
        publish();
      },
      collapseTree() {
        intent++;
        model.collapseAll();
        batch(() => {
          set('busy', false);
          publish();
        });
      },
      setAutoRevealSuppressed: (value: boolean) => set('suppressed', value),
      openNewItem(type: string, dir = '') {
        set('newItem', {
          type,
          path: dir ? dir.replace(/\/+$/, '') + '/' : '',
          pending: false,
          error: '',
        });
      },
      setNewItemPath: (path: string) => set('newItem', 'path', path),
      closeNewItem,
      createItem,
      async copyTreePath(path: string, kind: string) {
        const value = copyPath(path, kind, app.state.workspace.meta?.root);
        await navigator.clipboard.writeText(value);
        toast('success', 'Copied ' + value);
      },
    },
  };
}
