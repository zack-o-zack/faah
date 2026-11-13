import { batch, createMemo, onCleanup } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { api, apiPostJson } from '../lib/api.ts';
import { toast } from '../lib/toast.jsx';
import { cleanCommitMessage, gitCounts, syncPlan, syncNotice } from './logic.js';
/** @returns {{message:string,pending:string,error:string,notice:object|null,recent:object[],unpushed:object[],upstream:string,commitsUrl:string,sync:object,collapsed:boolean,unpushedCollapsed:boolean,height:number,unpushedHeight:number}} */
function initialState() {
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
    height: 340,
    unpushedHeight: 180,
  };
}
export function createGitStore(app, options = {}) {
  const request = options.request || api;
  const post = options.post || apiPostJson;
  const [state, set] = createStore(initialState());
  const controllers = new Set();
  const fileCache = new Map();
  let disposed = false;
  let listGeneration = 0;
  let signature = '';
  const counts = createMemo(() =>
    gitCounts(app.state.git.snapshot || { gitChanges: app.state.workspace.meta?.gitChanges || 0 }),
  );
  const recent = () =>
    state.showAll ? state.recent : app.state.git.snapshot?.recentCommits || state.recent;
  async function get(path, params) {
    const controller = new AbortController();
    controllers.add(controller);
    try {
      return await request(path, params, { signal: controller.signal });
    } finally {
      controllers.delete(controller);
    }
  }
  function notice(value) {
    set('notice', reconcile(value));
    set('collapsed', false);
  }
  async function refreshUnpushed(snapshot) {
    if (!app.state.workspace.meta?.git) return;
    const next = snapshot
      ? `${snapshot.ahead || 0}:${snapshot.recentCommits?.[0]?.hash || ''}`
      : '';
    if (next && next === signature) return;
    signature = next;
    const generation = ++listGeneration;
    try {
      const result = await get('api/unpushed');
      if (disposed || generation !== listGeneration) return;
      batch(() => {
        set('unpushed', reconcile(result.commits || [], { key: 'hash' }));
        set('upstream', result.upstream || '');
        app.actions.setUnpushedCount((result.commits || []).length);
      });
    } catch (error) {
      if (!disposed && error.name !== 'AbortError') set('error', error.message);
    }
  }
  async function fetchRecentCommits(limit = 5) {
    if (!app.state.workspace.meta?.git) return;
    const result = await get('api/git/log', { limit });
    if (disposed) return;
    set('showAll', limit > 5);
    set('recent', reconcile(result.commits || [], { key: 'full' }));
    set('commitsUrl', result.commitsUrl || '');
  }
  async function refreshHistory() {
    await options.historyChanged?.();
    await Promise.all([fetchRecentCommits(), refreshUnpushed(), app.actions.refreshWorkspace()]);
  }
  async function run(name, operation) {
    if (state.pending || disposed) return false;
    const controller = new AbortController();
    controllers.add(controller);
    set({ pending: name, error: '' });
    try {
      await operation(controller.signal);
      return true;
    } catch (error) {
      if (!disposed && error.name !== 'AbortError') {
        set('error', error.message);
        if (['diverged', 'in-progress'].includes(error.body?.code)) notice(syncNotice(error.body));
        else notice({ tone: 'err', title: `${name} failed`, text: error.message, choices: [] });
      }
      return false;
    } finally {
      controllers.delete(controller);
      if (!disposed) set('pending', '');
    }
  }
  async function generate(signal) {
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
  async function commitOperation(signal) {
    const message = state.message.trim() || (await generate(signal));
    await post('api/git/commit', { message }, { signal });
    if (disposed) return;
    set({ message: '', notice: null });
    toast('success', 'Committed');
    await refreshHistory();
  }
  const commit = () => run('Commit', commitOperation);
  async function syncOperation(signal) {
    const plan = syncPlan(app.state.git.snapshot);
    if (plan.pull) await pull(signal);
    if (plan.push) {
      if (state.sync.rewritten) confirmForcePush();
      else await push(signal);
    }
  }
  async function push(signal, force = false) {
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
  async function pull(signal) {
    await post('api/git/pull', {}, { signal });
    if (disposed) return;
    set('notice', null);
    await refreshHistory();
  }
  async function initializeGit() {
    if (!app.state.workspace.meta?.git) return;
    try {
      await Promise.all([fetchRecentCommits(), refreshUnpushed()]);
      const sync = await get('api/git/sync-state');
      if (disposed) return;
      set('sync', reconcile(sync));
      if (sync.inProgress) notice(syncNotice(sync));
    } catch (error) {
      if (!disposed && error.name !== 'AbortError') set('error', error.message);
    }
  }
  async function startSync(strategy) {
    return run(strategy, async (signal) => {
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
      const sync = await get('api/git/sync-state');
      if (disposed) return;
      set('sync', reconcile(sync));
      await refreshHistory();
      const log = job.stdout || job.log || '';
      if (sync.inProgress || sync.behind > 0) notice(syncNotice(sync, job.error || '', log));
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
    setCommitMessage: (message) => set('message', message),
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
        const sync = await get('api/git/sync-state', { fetch: 1 });
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
    setGitPanelCollapsed: (collapsed) => set('collapsed', collapsed),
    setUnpushedCollapsed: (collapsed) => set('unpushedCollapsed', collapsed),
    setGitPanelHeight: (height) => set({ height, collapsed: false }),
    setUnpushedHeight: (height) => set({ unpushedHeight: height, unpushedCollapsed: false }),
    loadCommitFiles(sha) {
      if (!fileCache.has(sha)) {
        const operation = get('api/commitfiles', { sha }).then(
          (result) => result.files || [],
          (error) => {
            fileCache.delete(sha);
            throw error;
          },
        );
        fileCache.set(sha, operation);
        // Bound retained history when browsing a long-running workspace.
        if (fileCache.size > 50) fileCache.delete(fileCache.keys().next().value);
      }
      return fileCache.get(sha);
    },
    async openCommitFile(sha, file) {
      if (file.binary) {
        toast('error', 'Binary file, no diff to show');
        return;
      }
      await options.openFile(file.path, { ref: sha, view: 'diff' });
    },
  };
  return { state, counts, recent, actions };
}
