import { batch, onCleanup } from 'solid-js';
import { reconcile } from 'solid-js/store';
import { api, apiPost } from '../lib/api.js';
import { createWorkspaceStream } from './stream.js';
import { workspacePatch } from './snapshot.js';

export function createWorkspaceActions(store, set, { request = api, post = apiPost } = {}) {
  const observers = new Set();
  let refreshing;
  let requestController;
  let disposed = false;
  let noteTimer, reindexController;
  function acceptGitSnapshot(snapshot) {
    if (!snapshot || disposed) return;
    batch(() => {
      set('git', 'snapshot', reconcile(snapshot));
      if (store.state.workspace.meta) set('workspace', 'meta', workspacePatch(snapshot));
      set('git', 'revision', (revision) => revision + 1);
    });
    for (const observer of observers) observer(snapshot);
  }
  function acceptMetrics(metrics) {
    if (!disposed)
      batch(() => {
        set('workspace', 'metrics', reconcile(metrics));
        set('lsp', { enabled: !!metrics.lspEnabled, memBytes: metrics.lspMemBytes || 0 });
      });
  }
  async function refreshWorkspace() {
    if (refreshing || disposed) return refreshing;
    requestController = new AbortController();
    const options = { signal: requestController.signal };
    set('workspace', { pending: true, error: '' });
    refreshing = (async () => {
      try {
        if (store.state.workspace.meta?.git) {
          acceptGitSnapshot(await post('api/git/refresh', {}, options));
        } else {
          const meta = await request('api/meta', undefined, options);
          if (disposed) return;
          store.actions.setWorkspace(meta);
          acceptGitSnapshot({ git: false, statuses: {} });
        }
      } catch (error) {
        if (!disposed && error.name !== 'AbortError') set('workspace', 'error', error.message);
      } finally {
        refreshing = null;
        if (!disposed) set('workspace', 'pending', false);
      }
    })();
    return refreshing;
  }
  const stream = createWorkspaceStream({
    connected: (connected) => set('workspace', 'connected', connected),
    refresh: refreshWorkspace,
  });
  stream.subscribe('git-status', acceptGitSnapshot);
  stream.subscribe('metrics', acceptMetrics);
  onCleanup(() => {
    disposed = true;
    requestController?.abort();
    reindexController?.abort();
    clearTimeout(noteTimer);
  });
  return {
    observeGitSnapshots: (observer) => {
      observers.add(observer);
      return () => observers.delete(observer);
    },
    setWorkspaceError: (error) => set('workspace', 'error', error),
    setStatusNote(note, timeout = 0) {
      clearTimeout(noteTimer);
      set('workspace', 'note', note);
      if (note && timeout) noteTimer = setTimeout(() => set('workspace', 'note', ''), timeout);
    },
    async reindexWorkspace() {
      if (store.state.workspace.reindexing) return;
      reindexController = new AbortController();
      set('workspace', { reindexing: true, error: '' });
      try {
        const result = await request('api/reindex', undefined, {
          signal: reindexController.signal,
        });
        if (disposed) return;
        for (const key of ['files', 'indexMs', 'gitChanges', 'gitFiles'])
          if (result[key] !== undefined) set('workspace', 'meta', key, result[key]);
        await refreshWorkspace();
        return result;
      } catch (error) {
        if (!disposed && error.name !== 'AbortError') set('workspace', 'error', error.message);
      } finally {
        if (!disposed) set('workspace', 'reindexing', false);
      }
    },
    acceptGitSnapshot,
    acceptMetrics,
    refreshWorkspace,
    startWorkspaceStream: stream.start,
    subscribeWorkspaceEvent: stream.subscribe,
    setWorkspaceTopic: stream.topic,
    watchWorkspaceThread: stream.watch,
  };
}
