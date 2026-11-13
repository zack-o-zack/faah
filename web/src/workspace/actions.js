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
    if (!disposed) set('workspace', 'metrics', reconcile(metrics));
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
  });
  return {
    observeGitSnapshots: (observer) => {
      observers.add(observer);
      return () => observers.delete(observer);
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
