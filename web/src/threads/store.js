import { createWorkspaceSubscription } from '../workspace/stream.js';
import { batch, onCleanup } from 'solid-js';
import { createStore, reconcile, produce } from 'solid-js/store';
import { api, apiPostJson } from '../lib/api.js';
import { explainRequest, isThreadRunning, threadFileOptions, threadSummary } from './logic.js';
/** @returns {{available:boolean,list:object[],records:Object,current:string,draft:object|null,filter:string,message:string,pending:string,error:string,stale:object|null}} */
function initialState() {
  return {
    available: false,
    list: [],
    records: {},
    current: '',
    draft: null,
    filter: 'all',
    message: '',
    pending: '',
    error: '',
    stale: null,
  };
}
export function createThreadStore(editor, options = {}) {
  const app = editor.store;
  const [state, set] = createStore(initialState());
  const request = options.request || api;
  const post = options.post || apiPostJson;
  const requests = new Map();
  const controllers = new Set();
  let disposed = false,
    version = 0,
    releaseCurrent,
    prepareKey = '',
    explainController;
  const current = () => state.records[state.current] || null;
  const running = () => isThreadRunning(current());
  const showing = () => app.state.layout.threads && !!state.current;
  const list = () =>
    state.list.filter((thread) => state.filter !== 'file' || thread.path === editor.active()?.path);
  function showThreads() {
    app.actions.setPanelVisible('threads', true);
  }
  function unwatch() {
    releaseCurrent?.();
    releaseCurrent = null;
  }
  function watch(id) {
    unwatch();
    releaseCurrent = app.actions.watchWorkspaceThread(id);
  }
  function acceptThread(thread) {
    if (!thread?.id || disposed) return;
    batch(() => {
      if (state.records[thread.id]) set('records', thread.id, reconcile(thread, { key: 'id' }));
      else set('records', thread.id, thread);
      const summary = threadSummary(thread);
      const index = state.list.findIndex((item) => item.id === thread.id);
      if (index >= 0) set('list', index, reconcile(summary));
      else set('list', state.list.length, summary);
    });
    editor.actions.orbThread(thread);
  }
  function acceptSummary(summary) {
    const old = state.list.find((thread) => thread.id === summary.id);
    if (old?.running && !summary.running && summary.touched)
      void editor.actions.reloadWorkspace().catch((error) => set('error', error.message));
    const index = state.list.findIndex((thread) => thread.id === summary.id);
    if (index >= 0) set('list', index, reconcile(summary));
    else set('list', state.list.length, summary);
    editor.actions.orbSummary(summary);
  }
  function acceptDelta({ id, data }) {
    const index = state.records[id]?.turns?.findIndex((turn) => turn.id === data.turn);
    if (index === undefined || index < 0 || disposed) return;
    set('records', id, 'turns', index, 'reply', (reply) => (reply || '') + data.text);
  }
  function acceptTool({ id, data }) {
    const index = state.records[id]?.turns?.findIndex((turn) => turn.id === data.turn);
    if (index === undefined || index < 0 || disposed) return;
    if (!state.records[id].turns[index].tools) set('records', id, 'turns', index, 'tools', []);
    const tools = state.records[id].turns[index].tools;
    set('records', id, 'turns', index, 'tools', tools.length, data.text);
    editor.actions.orbStep(id, data.text);
  }
  function backToThreads() {
    version++;
    explainController?.abort();
    unwatch();
    set({ current: '', draft: null, message: '', pending: '', error: '' });
  }
  function removeThread(id) {
    requests.get(id)?.controller.abort();
    set('list', (list) => list.filter((thread) => thread.id !== id));
    set(
      produce((draft) => {
        delete draft.records[id];
      }),
    );
    if (state.current === id) backToThreads();
  }
  [
    createWorkspaceSubscription(app, 'threads:list', (list) =>
      set('list', reconcile(list || [], { key: 'id' })),
    ),
    createWorkspaceSubscription(app, 'threads:summary', acceptSummary),
    createWorkspaceSubscription(app, 'threads:deleted', ({ id }) => removeThread(id)),
    createWorkspaceSubscription(app, 'thread:thread', ({ data }) => acceptThread(data)),
    createWorkspaceSubscription(app, 'thread:delta', acceptDelta),
    createWorkspaceSubscription(app, 'thread:tool', acceptTool),
    createWorkspaceSubscription(app, 'thread:deleted', ({ id }) => removeThread(id)),
  ];
  async function ownedPost(path, body) {
    const controller = new AbortController();
    controllers.add(controller);
    try {
      return await post(path, body, { signal: controller.signal });
    } finally {
      controllers.delete(controller);
    }
  }
  async function initializeThreads() {
    if (app.state.workspace.meta?.threadsEnabled === false) return;
    try {
      const controller = new AbortController();
      controllers.add(controller);
      const result = await request('api/threads', undefined, { signal: controller.signal }).finally(
        () => controllers.delete(controller),
      );
      if (disposed) return;
      set({ available: true, list: result.threads || [] });
      app.actions.setWorkspaceTopic('threads', true);
    } catch (error) {
      if (!disposed && error.name !== 'AbortError') set('error', error.message);
    }
  }
  async function loadThread(id) {
    if (requests.has(id)) return requests.get(id).promise;
    const controller = new AbortController();
    const operation = { controller, promise: null };
    operation.promise = request('api/threads/get', { id }, { signal: controller.signal })
      .then((thread) => {
        if (disposed || controller.signal.aborted)
          throw new DOMException('Cancelled', 'AbortError');
        acceptThread(thread);
        return thread;
      })
      .finally(() => {
        if (requests.get(id) === operation) requests.delete(id);
      });
    requests.set(id, operation);
    return operation.promise;
  }
  async function openThread(id) {
    const alreadyCurrent = state.current === id && current();
    const mine = ++version;
    unwatch();
    set({ current: id, draft: null, error: '', pending: 'open', message: '' });
    showThreads();
    try {
      const thread = alreadyCurrent || (await loadThread(id));
      if (mine !== version || disposed) return;
      if (isThreadRunning(thread)) watch(id);
    } catch (error) {
      if (!disposed && mine === version && error.name !== 'AbortError') set('error', error.message);
    } finally {
      if (!disposed && mine === version) set('pending', '');
    }
  }
  function newThread(info) {
    version++;
    unwatch();
    const scope = editor.tree.scope() === 'yours' ? 'mine' : 'pr';
    set({
      current: '',
      draft: info?.path ? { ...explainRequest(info), scope } : { scope },
      message: '',
      error: '',
      pending: '',
    });
    showThreads();
    editor.actions.setSelection(null);
  }
  async function sendThread() {
    const message = state.message.trim();
    if (!message || state.pending || running()) return;
    const mine = version;
    const id = state.current;
    const draft = state.draft;
    set({ pending: 'send', error: '' });
    try {
      const thread = await ownedPost(
        draft ? 'api/threads/create' : 'api/threads/send',
        draft ? { ...draft, message } : { id, message },
      );
      if (disposed) return;
      acceptThread(thread);
      if (version !== mine) return;
      set({ current: thread.id, draft: null, message: '' });
      watch(thread.id);
    } catch (error) {
      if (!disposed && version === mine && error.name !== 'AbortError') set('error', error.message);
    } finally {
      if (!disposed && version === mine) set('pending', '');
    }
  }
  async function threadAction(name, params = {}, { accept = false } = {}) {
    if (state.pending) return;
    const id = params.id || state.current;
    set({ pending: name, error: '' });
    try {
      const result = await ownedPost('api/threads/' + name, { id, ...params });
      if (disposed) return;
      if (accept) acceptThread(result);
      if (name === 'delete') removeThread(id);
      if (name === 'revert') await editor.actions.reloadWorkspace();
      return result;
    } catch (error) {
      if (!disposed && error.name !== 'AbortError') set('error', error.message);
    } finally {
      if (!disposed) set('pending', '');
    }
  }
  async function explainSelection(info, force = false) {
    if (editor.active()?.dirty && editor.active().path === info.path) {
      set('error', 'Save the file before explaining');
      return;
    }
    const mine = ++version;
    explainController?.abort();
    explainController = new AbortController();
    unwatch();
    set({ current: '', draft: null, pending: 'explain', error: '', stale: null });
    editor.actions.orbBegin();
    try {
      const reply = await post(
        'api/explain',
        { ...explainRequest(info), force },
        { signal: explainController.signal },
      );
      if (disposed || mine !== version) return;
      acceptThread(reply.thread);
      set({
        current: reply.thread.id,
        stale: reply.stale ? { id: reply.thread.id, reason: reply.staleReason } : null,
      });
      editor.actions.orbAttach(reply.thread);
      if (isThreadRunning(reply.thread) || !reply.thread.turns?.length) watch(reply.thread.id);
    } catch (error) {
      if (!disposed && mine === version && error.name !== 'AbortError') {
        set('error', error.message);
        editor.actions.orbFailed(error.message);
      }
    } finally {
      if (!disposed && mine === version) set('pending', '');
    }
  }
  async function prepareExplanation(info) {
    if (editor.active()?.dirty || info.l2 - info.l1 >= 400 || info.text.length > 20000) return;
    const body = explainRequest(info),
      key = JSON.stringify(body);
    if (key === prepareKey) return;
    prepareKey = key;
    try {
      await ownedPost('api/explain/prepare', body);
    } catch {
      if (prepareKey === key) prepareKey = '';
    }
  }
  onCleanup(() => {
    disposed = true;
    unwatch();
    explainController?.abort();
    for (const controller of controllers) controller.abort();
    for (const operation of requests.values()) operation.controller.abort();
    app.actions.setWorkspaceTopic('threads', false);
  });
  return {
    state,
    current,
    running,
    list,
    showing,
    actions: {
      initializeThreads,
      acceptThread,
      loadThread,
      openThread,
      newThread,
      backToThreads,
      sendThread,
      explainSelection,
      prepareExplanation,
      showThreads,
      toggleThreads: () => app.actions.togglePanel('threads'),
      hideThreads: () => app.actions.setPanelVisible('threads', false),
      setThreadMessage: (message) => set('message', message),
      setThreadFilter: (filter) => set('filter', filter),
      cancelThread: () => threadAction('cancel'),
      deleteThread: (id = state.current) => {
        if (id && confirm('Delete this thread and its transcript?'))
          return threadAction('delete', { id });
      },
      setThreadScope(scope) {
        if (current()) return threadAction('scope', { scope }, { accept: true });
        if (state.draft) set('draft', 'scope', scope);
      },
      revertThreadTurn: (id, turn) => threadAction('revert', { id, turn }, { accept: true }),
      openThreadFile: (turn, path) => editor.actions.openFile(path, threadFileOptions(turn)),
    },
  };
}
