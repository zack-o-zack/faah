import type { AppStore } from '../app/store.ts';
import type { WorkspaceMeta } from '../app/types.ts';
import type { Request } from '../lib/api.ts';
import type { CoreActions } from '../editor/contracts.ts';
import type { EditTarget } from './logic.ts';
import type { AgentJob } from './job-decode.ts';
import type { Harness } from './decode.ts';
import { decodeAgents, decodeModels } from './decode.ts';
import { isAbort, errorMessage } from '../lib/decode.ts';
export interface AgentOptions {
  request?: Request;
  post?: Request;
}
export interface EditSession {
  id: number;
  target: EditTarget;
  instruction: string;
  queued: boolean;
  pending: boolean;
  error: string;
  job: AgentJob | null;
  threadId: string;
}
interface AgentState {
  harnesses: Harness[];
  selected: string;
  model: string;
  pinned: boolean;
  pending: string;
  error: string;
  sessions: EditSession[];
  focus: { id: number; sequence: number };
  batch: { pending: boolean; error: string; threadId: string; job: AgentJob | null };
}
interface AgentHost {
  store: AppStore;
  actions: Pick<
    CoreActions,
    'reloadOpenTabs' | 'openFile' | 'setSelection' | 'setPanelVisible' | 'refreshTree'
  >;
}
import { batch, createMemo, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import { api, apiPost } from '../lib/api.ts';
import { toast } from '../lib/toast.tsx';
import { agentSelection, editRequest, rangesOverlap } from './logic.ts';
import { createAgentJobs } from './jobs.ts';

function initialState(): AgentState {
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
export function createAgentStore(
  editor: AgentHost,
  options: AgentOptions = {},
): ReturnType<typeof buildAgentStore> {
  return buildAgentStore(editor, options);
}
function buildAgentStore(editor: AgentHost, options: AgentOptions = {}) {
  const [state, set] = createStore(initialState());
  const request = options.request || api;
  const post = options.post || apiPost;
  const app = editor.store;
  const jobs = createAgentJobs(app, options);
  const requests = new Set<AbortController>();
  const edits = new Map<number, AbortController>();
  const models = new Map<string, Promise<string[]>>();
  let sequence = 0,
    selectedVersion = 0,
    disposed = false,
    batchController: AbortController | undefined;
  let reloadChain = Promise.resolve();
  const targets = createMemo(() =>
    state.sessions.map((session) => ({ id: session.id, ...session.target })),
  );
  const ready = () =>
    state.sessions.filter((session) => !session.pending && session.instruction.trim());
  const indexOf = (id: number): number => state.sessions.findIndex((session) => session.id === id);
  const patchSession = (id: number, patch: Partial<EditSession>): void => {
    const index = indexOf(id);
    if (index >= 0) set('sessions', index, patch);
  };
  async function requestOwned(
    operation: (signal: AbortSignal) => Promise<unknown>,
  ): Promise<unknown> {
    const controller = new AbortController();
    requests.add(controller);
    try {
      return await operation(controller.signal);
    } finally {
      requests.delete(controller);
    }
  }
  function reloadWorkspace(focus?: EditTarget | null): Promise<void> {
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
      const result = decodeAgents(
        await requestOwned((signal) => request('api/agent/harnesses', undefined, { signal })),
      );
      if (!disposed) set(agentSelection(result));
    } catch (error) {
      if (!disposed && !isAbort(error)) set('error', errorMessage(error));
    } finally {
      if (!disposed) set('pending', '');
    }
  }
  async function selectAgent(name: string, model = ''): Promise<boolean> {
    const version = ++selectedVersion;
    set({ pending: 'select', error: '' });
    try {
      const result = decodeAgents(
        await requestOwned((signal) => post('api/agent/select', { name, model }, { signal })),
      );
      if (disposed || version !== selectedVersion) return false;
      set(agentSelection(result));
      return true;
    } catch (error) {
      if (!disposed && version === selectedVersion && !isAbort(error))
        set('error', errorMessage(error));
      return false;
    } finally {
      if (!disposed && version === selectedVersion) set('pending', '');
    }
  }
  function loadAgentModels(name: string): Promise<string[]> {
    if (!models.has(name)) {
      const operation = requestOwned((signal) => request('api/agent/models', { name }, { signal }))
        .then(decodeModels)
        .catch((error) => {
          models.delete(name);
          throw error;
        });
      models.set(name, operation);
    }
    return models.get(name) || Promise.resolve([]);
  }
  function openAgentEdit(info: EditTarget | null): number | undefined {
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
  async function cancelAgentEdit(id: number): Promise<void> {
    const session = state.sessions[indexOf(id)];
    edits.get(id)?.abort();
    edits.delete(id);
    patchSession(id, { pending: false });
    if (session?.job?.running && session.job.id)
      await jobs
        .cancelAgentJob(session.job.id)
        .catch((error) => patchSession(id, { error: errorMessage(error) }));
  }
  function closeAgentEdit(id: number): void {
    void cancelAgentEdit(id);
    set('sessions', (sessions) => sessions.filter((session) => session.id !== id));
  }
  async function applyAgentEdit(id: number): Promise<void> {
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
      if (!disposed && !controller.signal.aborted) patchSession(id, { error: errorMessage(error) });
    } finally {
      edits.delete(id);
      if (!disposed) patchSession(id, { pending: false });
    }
  }
  async function applyAgentBatch() {
    if (state.batch.pending) return;
    const sessions = ready();
    if (!sessions.length) return;
    const first = sessions[0];
    if (sessions.length === 1 && first) return applyAgentEdit(first.id);
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
      if (job.changed?.length || job.tracked === false) await reloadWorkspace(sessions[0]?.target);
    } catch (error) {
      if (!disposed && !controller.signal.aborted) set('batch', 'error', errorMessage(error));
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
        .catch((error) => set('batch', 'error', errorMessage(error)));
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
      setAgentInstruction: (id: number, instruction: string) => patchSession(id, { instruction }),
      queueAgentEdit: (id: number, queued = true) => patchSession(id, { queued }),
      clearAgentEdits: () => {
        for (const session of [...state.sessions]) closeAgentEdit(session.id);
      },
      focusAgentAt(path: string, line: number): void {
        const session = state.sessions.find(
          (item) => item.target.path === path && line >= item.target.l1 && line <= item.target.l2,
        );
        if (!session) return;
        patchSession(session.id, { queued: false });
        set('focus', { id: session.id, sequence: state.focus.sequence + 1 });
        app.actions.setPanelVisible('threads', true);
      },
      acceptAgentMeta: (meta: WorkspaceMeta) =>
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
