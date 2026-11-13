import type { AppStore } from '../app/store.ts';
import type { Request } from '../lib/api.ts';
import type { OpenOptions } from '../editor/types.ts';
import type { GitSnapshot, GitCommit } from '../workspace/decode.ts';
import type { GitNotice } from './logic.ts';
import type { SyncState, UnpushedCommit, CommitFile } from './decode.ts';
import {
  decodeSync,
  decodeUnpushed,
  decodeLog,
  decodeCommitFiles,
  decodeSyncError,
} from './decode.ts';
import { errorMessage, isAbort } from '../lib/decode.ts';
interface AgentProgress {
  id?: number;
  ms?: number;
  stdout?: string;
  log?: string;
  error?: string;
}
export interface GitOptions {
  request?: Request;
  post?: Request;
  historyChanged?: () => Promise<void>;
  openFile?: (path: string, opts: OpenOptions) => Promise<unknown>;
  runAgent?: (
    path: string,
    params: unknown,
    options: { signal: AbortSignal; progress: (value: AgentProgress) => void },
  ) => Promise<AgentProgress>;
  cancelAgent?: (id?: number) => unknown;
}
interface GitState {
  message: string;
  showAll: boolean;
  pending: string;
  error: string;
  notice: GitNotice | null;
  recent: GitCommit[];
  unpushed: UnpushedCommit[];
  upstream: string;
  commitsUrl: string;
  sync: SyncState;
  collapsed: boolean;
  unpushedCollapsed: boolean;
  height: number;
  unpushedHeight: number;
}
import { batch, createMemo, onCleanup } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { api, apiPostJson } from '../lib/api.ts';
import { toast } from '../lib/toast.jsx';
import { cleanCommitMessage, gitCounts, syncPlan, syncNotice } from './logic.ts';

function initialState(): GitState {
  return {
    message: '',
    showAll: false,
    pending: '',
    error: '',
    notice: null,
    recent: [],
    unpushed: [],
    upstream: '',
    commitsUrl: '',
    sync: {},
    collapsed: false,
    unpushedCollapsed: false,
    height: 384,
    unpushedHeight: 0,
  };
}
export function createGitStore(
  app: AppStore,
  options: GitOptions = {},
): ReturnType<typeof buildGitStore> {
  return buildGitStore(app, options);
}
function buildGitStore(app: AppStore, options: GitOptions = {}) {
  const request = options.request || api;
  const post = options.post || apiPostJson;
  const [state, set] = createStore(initialState());
  const controllers = new Set<AbortController>();
  const fileCache = new Map<string, Promise<CommitFile[]>>();
  let disposed = false;
  let listGeneration = 0;
  let signature = '';
  const counts = createMemo(() =>
    gitCounts(app.state.git.snapshot || { gitChanges: app.state.workspace.meta?.gitChanges || 0 }),
  );
  const recent = () =>
    state.showAll ? state.recent : app.state.git.snapshot?.recentCommits || state.recent;
  async function get(path: string, params?: unknown): Promise<unknown> {
    const controller = new AbortController();
    controllers.add(controller);
    try {
      return await request(path, params, { signal: controller.signal });
    } finally {
      controllers.delete(controller);
    }
  }
  function notice(value: GitNotice): void {
    set('notice', reconcile(value));
    set('collapsed', false);
  }
  async function refreshUnpushed(snapshot?: GitSnapshot): Promise<void> {
    if (!app.state.workspace.meta?.git) return;
    const next = snapshot
      ? `${snapshot.ahead || 0}:${snapshot.recentCommits?.[0]?.hash || ''}`
      : '';
    if (next && next === signature) return;
    signature = next;
    const generation = ++listGeneration;
    try {
      const result = decodeUnpushed(await get('api/unpushed'));
      if (disposed || generation !== listGeneration) return;
      batch(() => {
        set('unpushed', reconcile(result.commits || [], { key: 'hash' }));
        set('upstream', result.upstream || '');
        app.actions.setUnpushedCount((result.commits || []).length);
      });
    } catch (error) {
      if (!disposed && !isAbort(error)) set('error', errorMessage(error));
    }
  }
  async function fetchRecentCommits(limit = 5) {
    if (!app.state.workspace.meta?.git) return;
    const result = decodeLog(await get('api/git/log', { limit }));
    if (disposed) return;
    set('showAll', limit > 5);
    set('recent', reconcile(result.commits || [], { key: 'full' }));
    set('commitsUrl', result.commitsUrl || '');
  }
  async function refreshHistory() {
    await options.historyChanged?.();
    await Promise.all([fetchRecentCommits(), refreshUnpushed(), app.actions.refreshWorkspace()]);
  }
  async function run(
    name: string,
    operation: (signal: AbortSignal) => Promise<unknown>,
  ): Promise<boolean> {
    if (state.pending || disposed) return false;
    const controller = new AbortController();
    controllers.add(controller);
    set({ pending: name, error: '' });
    try {
      await operation(controller.signal);
      return true;
    } catch (error) {
      if (!disposed && !isAbort(error)) {
        set('error', errorMessage(error));
        const state = decodeSyncError(error);
        if (state && ['diverged', 'in-progress'].includes(state.code || ''))
          notice(syncNotice(state));
        else
          notice({ tone: 'err', title: `${name} failed`, text: errorMessage(error), choices: [] });
      }
      return false;
    } finally {
      controllers.delete(controller);
      if (!disposed) set('pending', '');
    }
  }
  async function generate(signal: AbortSignal): Promise<string> {
    if (!options.runAgent) throw new Error('Agent service is unavailable');
    const job = await options.runAgent(
      'api/git/commit-message',
      {},
      {
        signal,
        progress: (value) => {
          if (!disposed)
            notice({
              tone: 'busy',
              title: 'Writing message…',
              text: `${Math.round((value.ms || 0) / 1000)}s`,
              log: value.stdout || value.log || '',
              choices: [],
            });
        },
      },
    );
    const message = cleanCommitMessage(job.stdout || job.log || '');
    if (!message) throw new Error('The harness returned an empty message.');
    set('message', message);
    return message;
  }
  async function commitOperation(signal: AbortSignal): Promise<void> {
    const message = state.message.trim() || (await generate(signal));
    await post('api/git/commit', { message }, { signal });
    if (disposed) return;
    set({ message: '', notice: null });
    toast('success', 'Committed');
    await refreshHistory();
  }
  const commit = () => run('Commit', commitOperation);
  async function syncOperation(signal: AbortSignal): Promise<void> {
    const plan = syncPlan(app.state.git.snapshot || {});
    if (plan.pull) await pull(signal);
    if (plan.push) {
      if (state.sync.rewritten) confirmForcePush();
      else await push(signal);
    }
  }
  async function push(signal: AbortSignal, force = false): Promise<void> {
    await post('api/git/push', force ? { force: true } : {}, { signal });
    if (disposed) return;
    set('sync', { rewritten: false });
    set('notice', null);
    toast('success', 'Pushed');
    await refreshHistory();
  }
  function confirmForcePush() {
    notice({
      tone: 'warn',
      title: 'Force-push?',
      text: 'This checkout was rebased. Its commits replace the remote commits using --force-with-lease; a newer remote update refuses the push.',
      choices: ['force', 'dismiss'],
    });
  }
  async function pull(signal: AbortSignal): Promise<void> {
    await post('api/git/pull', {}, { signal });
    if (disposed) return;
    set('notice', null);
    await refreshHistory();
  }
  async function initializeGit() {
    if (!app.state.workspace.meta?.git) return;
    try {
      await Promise.all([fetchRecentCommits(), refreshUnpushed()]);
      const sync = decodeSync(await get('api/git/sync-state'));
      if (disposed) return;
      set('sync', reconcile(sync));
      if (sync.inProgress) notice(syncNotice(sync));
    } catch (error) {
      if (!disposed && !isAbort(error)) set('error', errorMessage(error));
    }
  }
  async function startSync(strategy: string): Promise<boolean> {
    return run(strategy, async (signal) => {
      if (!options.runAgent) throw new Error('Agent service is unavailable');
      const job = await options.runAgent(
        'api/git/sync-agent',
        { strategy },
        {
          signal,
          progress: (value) => {
            if (!disposed)
              notice({
                tone: 'busy',
                title: `${strategy} in progress`,
                text: `${Math.round((value.ms || 0) / 1000)}s`,
                log: value.stdout || value.log || '',
                choices: ['cancel'],
                job: value.id,
              });
          },
        },
      );
      const sync = decodeSync(await get('api/git/sync-state'));
      if (disposed) return;
      set('sync', reconcile(sync));
      await refreshHistory();
      const log = job.stdout || job.log || '';
      if (sync.inProgress || (sync.behind || 0) > 0) notice(syncNotice(sync, job.error || '', log));
      else
        notice({
          tone: 'ok',
          title: `${strategy} complete`,
          text: 'Review the result before pushing.',
          log,
          choices: sync.rewritten ? ['force'] : ['push'],
        });
    });
  }
  const release = app.actions.observeGitSnapshots((snapshot) => {
    if (snapshot.rewritten !== undefined) set('sync', 'rewritten', !!snapshot.rewritten);
    void refreshUnpushed(snapshot);
  });
  onCleanup(() => {
    disposed = true;
    release();
    for (const controller of controllers) controller.abort();
    fileCache.clear();
  });
  const actions = {
    initializeGit,
    refreshUnpushed,
    fetchRecentCommits,
    setCommitMessage: (message: string) => set('message', message),
    commit,
    generateCommitMessage: () =>
      run('Generate message', async (signal) => {
        await generate(signal);
        if (!disposed) set('notice', null);
      }),
    pullGit: () => run('Pull', pull),
    pushGit(force = false) {
      if (!force && (state.sync.rewritten || app.state.git.snapshot?.rewritten)) {
        confirmForcePush();
        return;
      }
      return run('Push', (signal) => push(signal, force));
    },
    syncGit: () => run('Sync', syncOperation),
    resolvePRBase: () =>
      run('Fetch base', async () => {
        const sync = decodeSync(await get('api/git/sync-state', { fetch: 1 }));
        if (disposed) return;
        set('sync', reconcile(sync));
        if (sync.rewritten) confirmForcePush();
        else if (sync.inProgress || sync.behind) notice(syncNotice(sync));
        else
          notice({
            tone: 'ok',
            title: 'Up to date',
            text: 'The checkout already includes the base branch.',
            choices: [],
          });
      }),
    confirmForcePush,
    startSync,
    abortGitSync: () =>
      run('Abort', async (signal) => {
        await post('api/git/abort', {}, { signal });
        set('sync', { inProgress: '' });
        await refreshHistory();
        notice({
          tone: 'ok',
          title: 'Aborted',
          text: 'The checkout is back where it was.',
          choices: [],
        });
      }),
    cancelGitJob: () => options.cancelAgent?.(state.notice?.job),
    clearGitNotice: () => {
      if (!state.pending) set('notice', null);
    },
    setGitPanelCollapsed: (collapsed: boolean) => set('collapsed', collapsed),
    setUnpushedCollapsed: (collapsed: boolean) => set('unpushedCollapsed', collapsed),
    setGitPanelHeight: (height: number) => set({ height, collapsed: false }),
    setUnpushedHeight: (height: number) =>
      set({ unpushedHeight: height, unpushedCollapsed: false }),
    loadCommitFiles(sha: string): Promise<CommitFile[]> {
      if (!fileCache.has(sha)) {
        const operation = get('api/commitfiles', { sha }).then(
          (result) => decodeCommitFiles(result).files,
          (error) => {
            fileCache.delete(sha);
            throw error;
          },
        );
        fileCache.set(sha, operation);
        // Bound retained history when browsing a long-running workspace.
        const oldest = fileCache.keys().next().value;
        if (fileCache.size > 50 && oldest !== undefined) fileCache.delete(oldest);
      }
      return fileCache.get(sha) || Promise.resolve([]);
    },
    async openCommitFile(sha: string, file: CommitFile): Promise<void> {
      if (file.binary) {
        toast('error', 'Binary file, no diff to show');
        return;
      }
      await options.openFile?.(file.path, { ref: sha, view: 'diff' });
    },
  };
  return { state, counts, recent, actions };
}
