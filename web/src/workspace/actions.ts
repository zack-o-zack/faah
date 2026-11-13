import type { SetStoreFunction } from 'solid-js/store';
import type { AppState } from '../app/store.ts';
import type { Request } from '../lib/api.ts';
import { errorMessage, isAbort } from '../lib/decode.ts';
import { decodeGitSnapshot, decodeMetrics, decodeMeta, decodeReindex } from './decode.ts';
import type { GitSnapshot } from './decode.ts';
import { batch, onCleanup } from 'solid-js';
import { reconcile } from 'solid-js/store';
import { api, apiPost } from '../lib/api.ts';
import { createWorkspaceStream } from './stream.ts';
import { workspacePatch } from './snapshot.ts';

export function createWorkspaceActions(
  ...args: Parameters<typeof buildWorkspaceActions>
): ReturnType<typeof buildWorkspaceActions> {
  return buildWorkspaceActions(...args);
}
function buildWorkspaceActions(
  store: { state: AppState; actions: { setWorkspace: (meta: unknown) => void } },
  set: SetStoreFunction<AppState>,
  { request = api, post = apiPost }: { request?: Request; post?: Request } = {},
) {
  const observers = new Set<(snapshot: GitSnapshot) => void>();
  let refreshing: Promise<void> | null = null;
  let requestController: AbortController | undefined;
  let disposed = false;
  let noteTimer: ReturnType<typeof setTimeout> | undefined;
  let reindexController: AbortController | undefined;
  function acceptGitSnapshot(input: unknown): void {
    if (!input || disposed) return;
    const snapshot = decodeGitSnapshot(input);
    batch(() => {
      set('git', 'snapshot', reconcile(snapshot));
      if (store.state.workspace.meta) set('workspace', 'meta', workspacePatch(snapshot));
      set('git', 'revision', (revision) => revision + 1);
    });
    for (const observer of observers) observer(snapshot);
  }
  function acceptMetrics(input: unknown): void {
    const metrics = decodeMetrics(input);
    if (!disposed)
      batch(() => {
        set('workspace', 'metrics', reconcile(metrics));
        set('lsp', { enabled: !!metrics.lspEnabled, memBytes: metrics.lspMemBytes || 0 });
      });
  }
  async function refreshWorkspace(): Promise<void> {
    if (refreshing || disposed) {
      if (refreshing) await refreshing;
      return;
    }
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
          store.actions.setWorkspace(decodeMeta(meta));
          acceptGitSnapshot({ git: false, statuses: {} });
        }
      } catch (error) {
        if (!disposed && !isAbort(error)) set('workspace', 'error', errorMessage(error));
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
    observeGitSnapshots: (observer: (snapshot: GitSnapshot) => void) => {
      observers.add(observer);
      return () => observers.delete(observer);
    },
    setWorkspaceError: (error: string) => set('workspace', 'error', error),
    setStatusNote(note: string, timeout = 0) {
      clearTimeout(noteTimer);
      set('workspace', 'note', note);
      if (note && timeout) noteTimer = setTimeout(() => set('workspace', 'note', ''), timeout);
    },
    async reindexWorkspace() {
      if (store.state.workspace.reindexing) return;
      reindexController = new AbortController();
      set('workspace', { reindexing: true, error: '' });
      try {
        const result = decodeReindex(
          await request('api/reindex', undefined, {
            signal: reindexController.signal,
          }),
        );
        if (disposed) return;
        set('workspace', 'meta', (current) => (current ? { ...current, ...result } : current));
        await refreshWorkspace();
        return result;
      } catch (error) {
        if (!disposed && !isAbort(error)) set('workspace', 'error', errorMessage(error));
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
