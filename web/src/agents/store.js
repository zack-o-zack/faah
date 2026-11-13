import { batch, createMemo, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import { api, apiPost } from '../lib/api.ts';
import { toast } from '../lib/toast.jsx';
import { agentSelection, editRequest, rangesOverlap } from './logic.js';
import { createAgentJobs } from './jobs.js';
/** @returns {{harnesses:object[],selected:string,model:string,pinned:boolean,pending:string,error:string,sessions:object[],batch:object}} */
function initialState() {
  return {
    harnesses: [],
    selected: '',
    model: '',
    pinned: false,
    pending: '',
    error: '',
    sessions: [],
    focus: { id: 0, sequence: 0 },
    batch: { pending: false, error: '', threadId: '', job: null },
  };
}
export function createAgentStore(editor, options = {}) {
  const [state, set] = createStore(initialState());
  const request = options.request || api;
  const post = options.post || apiPost;
  const app = editor.store;
  const jobs = createAgentJobs(app, options);
  const requests = new Set();
  const edits = new Map();
  const models = new Map();
  let sequence = 0,
    selectedVersion = 0,
    disposed = false,
    batchController;
  let reloadChain = Promise.resolve();
  const targets = createMemo(() =>
    state.sessions.map((session) => ({ id: session.id, ...session.target })),
  );
  const ready = () =>
    state.sessions.filter((session) => !session.pending && session.instruction.trim());
  const indexOf = (id) => state.sessions.findIndex((session) => session.id === id);
  const patchSession = (id, patch) => {
    const index = indexOf(id);
    if (index >= 0) set('sessions', index, patch);
  };
  async function requestOwned(operation) {
    const controller = new AbortController();
    requests.add(controller);
    try {
      return await operation(controller.signal);
    } finally {
      requests.delete(controller);
    }
  }
  function reloadWorkspace(focus) {
    const run = async () => {
      if (disposed) return;
      await app.actions.reindexWorkspace();
      await editor.actions.reloadOpenTabs();
      await editor.actions.refreshTree();
      if (focus?.path && !disposed)
        await editor.actions.openFile(focus.path, { line: focus.l1, push: false });
    };
    const result = reloadChain.then(run, run);
    reloadChain = result.catch(() => {});
    return result;
  }
  async function initializeAgents() {
    if (app.state.workspace.meta?.agentEnabled === false) return;
    set({ pending: 'discover', error: '' });
    try {
      const result = await requestOwned((signal) =>
        request('api/agent/harnesses', undefined, { signal }),
      );
      if (!disposed) set(agentSelection(result));
    } catch (error) {
      if (!disposed && error.name !== 'AbortError') set('error', error.message);
    } finally {
      if (!disposed) set('pending', '');
    }
  }
  async function selectAgent(name, model = '') {
    const version = ++selectedVersion;
    set({ pending: 'select', error: '' });
    try {
      const result = await requestOwned((signal) =>
        post('api/agent/select', { name, model }, { signal }),
      );
      if (disposed || version !== selectedVersion) return false;
      set(agentSelection({ harnesses: state.harnesses, ...result }));
      return true;
    } catch (error) {
      if (!disposed && version === selectedVersion && error.name !== 'AbortError')
        set('error', error.message);
      return false;
    } finally {
      if (!disposed && version === selectedVersion) set('pending', '');
    }
  }
  function loadAgentModels(name) {
    if (!models.has(name)) {
      const operation = requestOwned((signal) => request('api/agent/models', { name }, { signal }))
        .then((reply) => reply.models || [])
        .catch((error) => {
          models.delete(name);
          throw error;
        });
      models.set(name, operation);
    }
    return models.get(name);
  }
  function openAgentEdit(info) {
    if (!info?.path) return;
    if (state.sessions.some((session) => rangesOverlap(session.target, info))) {
      toast('error', 'An edit already overlaps this range');
      return;
    }
    const id = ++sequence;
    set('sessions', state.sessions.length, {
      id,
      target: { path: info.path, l1: info.l1, l2: info.l2 },
      instruction: '',
      queued: false,
      pending: false,
      error: '',
      job: null,
      threadId: '',
    });
    editor.actions.setPanelVisible('threads', true);
    editor.actions.setSelection(null);
    return id;
  }
  async function cancelAgentEdit(id) {
    const session = state.sessions[indexOf(id)];
    edits.get(id)?.abort();
    edits.delete(id);
    patchSession(id, { pending: false });
    if (session?.job?.running && session.job.id)
      await jobs
        .cancelAgentJob(session.job.id)
        .catch((error) => patchSession(id, { error: error.message }));
  }
  function closeAgentEdit(id) {
    void cancelAgentEdit(id);
    set('sessions', (sessions) => sessions.filter((session) => session.id !== id));
  }
  async function applyAgentEdit(id) {
    const session = state.sessions[indexOf(id)];
    if (!session || session.pending || !session.instruction.trim()) return;
    const controller = new AbortController();
    edits.set(id, controller);
    patchSession(id, { pending: true, error: '', queued: false });
    try {
      const job = await jobs.runAgentJob('api/agent/edit', editRequest(session), {
        signal: controller.signal,
        progress: (job) => patchSession(id, { job, threadId: job.threadId || '' }),
      });
      if (disposed || controller.signal.aborted) return;
      if (job.error) {
        patchSession(id, { error: job.error });
        if (job.changed?.length) await reloadWorkspace();
      } else {
        closeAgentEdit(id);
        if (job.changed?.length || job.tracked === false) await reloadWorkspace(session.target);
        toast('success', 'Edit saved in Threads');
      }
    } catch (error) {
      if (!disposed && !controller.signal.aborted) patchSession(id, { error: error.message });
    } finally {
      edits.delete(id);
      if (!disposed) patchSession(id, { pending: false });
    }
  }
  async function applyAgentBatch() {
    if (state.batch.pending) return;
    const sessions = ready();
    if (!sessions.length) return;
    if (sessions.length === 1) return applyAgentEdit(sessions[0].id);
    batchController = new AbortController();
    const controller = batchController;
    batch(() => {
      set('batch', { pending: true, error: '' });
      for (const session of sessions) patchSession(session.id, { pending: true });
    });
    try {
      const job = await jobs.runAgentJob(
        'api/agent/batch',
        { edits: sessions.map(editRequest) },
        {
          signal: controller.signal,
          progress: (job) => set('batch', { job, threadId: job.threadId || '' }),
        },
      );
      if (disposed || controller.signal.aborted) return;
      if (job.error) set('batch', 'error', job.error);
      else {
        const ids = new Set(sessions.map((session) => session.id));
        set('sessions', (current) => current.filter((session) => !ids.has(session.id)));
        toast('success', 'Batch edit saved in Threads');
      }
      if (job.changed?.length || job.tracked === false) await reloadWorkspace(sessions[0].target);
    } catch (error) {
      if (!disposed && !controller.signal.aborted) set('batch', 'error', error.message);
    } finally {
      if (!disposed)
        batch(() => {
          set('batch', 'pending', false);
          for (const session of sessions) patchSession(session.id, { pending: false });
        });
    }
  }
  async function cancelAgentBatch() {
    batchController?.abort();
    if (state.batch.job?.id)
      await jobs
        .cancelAgentJob(state.batch.job.id)
        .catch((error) => set('batch', 'error', error.message));
  }
  onCleanup(() => {
    disposed = true;
    batchController?.abort();
    for (const controller of requests) controller.abort();
    for (const controller of edits.values()) controller.abort();
    models.clear();
  });
  return {
    state,
    targets,
    ready,
    actions: {
      initializeAgents,
      selectAgent,
      loadAgentModels,
      openAgentEdit,
      closeAgentEdit,
      applyAgentEdit,
      applyAgentBatch,
      cancelAgentEdit,
      cancelAgentBatch,
      reloadWorkspace,
      ...jobs,
      setAgentInstruction: (id, instruction) => patchSession(id, { instruction }),
      queueAgentEdit: (id, queued = true) => patchSession(id, { queued }),
      clearAgentEdits: () => {
        for (const session of [...state.sessions]) closeAgentEdit(session.id);
      },
      focusAgentAt(path, line) {
        const session = state.sessions.find(
          (item) => item.target.path === path && line >= item.target.l1 && line <= item.target.l2,
        );
        if (!session) return;
        patchSession(session.id, { queued: false });
        set('focus', { id: session.id, sequence: state.focus.sequence + 1 });
        app.actions.setPanelVisible('threads', true);
      },
      acceptAgentMeta: (meta) =>
        set(
          agentSelection({
            harnesses: meta.agents,
            selected: meta.agent,
            model: meta.agentModel,
            pinned: meta.agentPinned,
          }),
        ),
    },
  };
}
