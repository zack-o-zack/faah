import type { AppStore } from '../app/store.ts';
import type { Request } from '../lib/api.ts';
import type { CoreActions } from '../editor/contracts.ts';
import type { StageDraft, ReviewRun, ReviewConfig, ReviewEvent } from './types.ts';
import { decodeReviewEvent, decodeReviewStatus, decodeWalkthrough } from './decode.ts';
import { decodeThread } from '../threads/decode.ts';
import { isAbort, errorMessage } from '../lib/decode.ts';
export interface ReviewOptions {
  request?: Request;
  post?: Request;
}
interface ReviewState {
  mode: 'code' | 'review';
  layout: 'vertical' | 'horizontal';
  tab: 'walkthrough' | 'stages';
  config: ReviewConfig;
  run: ReviewRun | null;
  active: number;
  pending: string;
  error: string;
  loadingThread: string;
  edit: { index: number; value: StageDraft } | null;
  followup: string;
  filter: string;
  target: { path: string; line: number; sequence: number };
  activeFile: string;
  viewed: Record<string, boolean>;
  returnTo: { path: string; line: number; title: string } | null;
}
interface ReviewHost {
  store: AppStore;
  actions: Pick<CoreActions, 'loadThread' | 'acceptThread' | 'openFile'>;
}
import {
  batch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { api, apiPostJson } from '../lib/api.ts';
import { createResourceRequest } from '../lib/resource-request.ts';
import { toast } from '../lib/toast.jsx';
import { createWorkspaceSubscription } from '../workspace/stream.ts';
import {
  REVIEW_EVENTS,
  activeAfterChange,
  changeStage,
  configRequest,
  emptyStage,
  isRunning,
  reviewStages,
  reviewTransition,
  stageDefinition,
  workflowConfig,
} from './logic.ts';

const LAYOUT_KEY = 'faah-review-layout';

function initialState(): ReviewState {
  return {
    mode: 'code',
    layout: localStorage.getItem(LAYOUT_KEY) === 'horizontal' ? 'horizontal' : 'vertical',
    tab: 'walkthrough',
    config: { name: 'Review pipeline', stages: [] },
    run: null,
    active: 0,
    pending: '',
    error: '',
    loadingThread: '',
    edit: null,
    followup: '',
    filter: 'all',
    target: { path: '', line: 0, sequence: 0 },
    activeFile: '',
    viewed: {},
    returnTo: null,
  };
}

export function createReviewStore(editor: ReviewHost, options: ReviewOptions = {}) {
  const app = editor.store;
  const request = options.request || api;
  const post = options.post || apiPostJson;
  const [state, set] = createStore(initialState());
  const [revision, setRevision] = createSignal(1);
  const walkthroughRequest = createResourceRequest(request);
  const controllers = new Set<AbortController>();
  let disposed = false;
  let statusController: AbortController | undefined;
  let nextId = 0;

  const stages = createMemo(() => reviewStages(state.config, state.run));
  const active = () => stages()[state.active] || null;
  const running = () => isRunning(state.run);
  const [walkthrough] = createResource(
    () => state.mode === 'review' && state.tab === 'walkthrough' && revision(),
    async () => decodeWalkthrough(await walkthroughRequest('api/review/walkthrough')),
  );

  // The stage on screen follows its thread on the shared stream; the thread store
  // accumulates the streamed reply into that record.
  const watchedThread = () =>
    state.mode === 'review' && state.tab === 'stages' ? active()?.threadId || '' : '';
  createEffect(
    on(watchedThread, (id) => {
      if (!id) return;
      const release = app.actions.watchWorkspaceThread(id);
      set('loadingThread', id);
      editor.actions
        .loadThread(id)
        .catch((error) => {
          if (!disposed && !isAbort(error)) set('error', errorMessage(error));
        })
        .finally(() => {
          if (!disposed && state.loadingThread === id) set('loadingThread', '');
        });
      onCleanup(release);
    }),
  );

  function acceptRun(run?: ReviewRun | null): void {
    if (disposed || !run) return;
    set('run', reconcile(run));
  }
  function acceptEvent(name: string, data: ReviewEvent | null): void {
    const current = state.run;
    const next = reviewTransition(current, name, data);
    if (!next || next === current) return;
    const samePlan =
      current && next.id === current.id && next.stages.length === current.stages.length;
    if (!samePlan || (data && 'stages' in data)) return acceptRun(next);
    const stage = next.stages[next.activeStage];
    if (!stage) return;
    batch(() => {
      set('run', 'stages', next.activeStage, reconcile(stage));
      set('run', 'activeStage', next.activeStage);
    });
  }
  for (const name of REVIEW_EVENTS)
    createWorkspaceSubscription(app, 'review:' + name, (data) =>
      acceptEvent(name, decodeReviewEvent(data)),
    );

  async function owned(path: string, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    controllers.add(controller);
    try {
      return await post(path, body, { signal: controller.signal });
    } finally {
      controllers.delete(controller);
    }
  }
  async function operation(
    name: string,
    path: string,
    body: unknown,
    accept: (reply: unknown) => void,
  ): Promise<unknown> {
    if (state.pending && state.pending !== 'load') return;
    set({ pending: name, error: '' });
    try {
      const reply = await owned(path, body);
      if (!disposed) accept(reply);
      return reply;
    } catch (error) {
      if (!disposed && !isAbort(error)) set('error', errorMessage(error));
    } finally {
      if (!disposed) set('pending', '');
    }
  }

  async function loadReview() {
    statusController?.abort();
    const controller = new AbortController();
    statusController = controller;
    set({ pending: 'load', error: '' });
    try {
      const reply = decodeReviewStatus(
        await request('api/review-workflow/status', undefined, {
          signal: controller.signal,
        }),
      );
      if (disposed || controller.signal.aborted) return;
      batch(() => {
        if (reply.config) set('config', reconcile(workflowConfig(reply.config)));
        if (reply.run) acceptRun(reply.run);
        if (reply.run && Number.isInteger(reply.run.activeStage))
          set('active', reply.run.activeStage);
      });
    } catch (error) {
      if (!disposed && !controller.signal.aborted) set('error', errorMessage(error));
    } finally {
      if (!disposed && statusController === controller) set('pending', '');
    }
  }

  function setReviewMode(mode: string): void {
    const next = mode === 'review' ? 'review' : 'code';
    if (state.mode === next) return;
    set('mode', next);
    app.actions.setWorkspaceTopic('review', next === 'review');
    if (next === 'review') void loadReview();
    else statusController?.abort();
  }

  function saveConfig(config: ReviewConfig, accept = () => {}): Promise<unknown> {
    return operation('config', 'api/review-workflow/config', configRequest(config), (value) => {
      const reply = decodeReviewStatus(value);
      batch(() => {
        set('config', reconcile(workflowConfig(reply.config || config)));
        accept();
      });
    });
  }

  async function saveStage() {
    if (!state.edit) return;
    const { index, value } = state.edit;
    let definition;
    try {
      definition = stageDefinition(value, value.id || `stage-${Date.now()}-${++nextId}`, index < 0);
    } catch (error) {
      set('error', errorMessage(error));
      return;
    }
    const list = state.config.stages.slice();
    if (index < 0) list.push(definition);
    else list[index] = definition;
    await saveConfig({ ...state.config, stages: list }, () => {
      set({ edit: null, active: index < 0 ? list.length - 1 : index });
      toast('success', index < 0 ? `Added stage: ${definition.title}` : 'Stage updated');
    });
  }

  async function mutateStage(index: number, action: string): Promise<void> {
    if (running()) {
      set('error', 'Stop the pipeline before changing its stages');
      return;
    }
    let config;
    try {
      config = changeStage(state.config, index, action);
    } catch (error) {
      set('error', errorMessage(error));
      return;
    }
    if (config === state.config) return;
    const active = activeAfterChange(state.active, index, action, config.stages.length);
    await saveConfig(config, () => set('active', active));
  }

  function runReview(index = 0) {
    set('active', index);
    return operation(
      'run',
      'api/review-workflow/run',
      { workflowId: 'standard', stageIndex: index },
      (reply) => acceptRun(decodeReviewStatus(reply).run),
    );
  }

  async function sendReviewFollowup() {
    const id = active()?.threadId;
    const message = state.followup.trim();
    if (!message) return;
    if (!id) {
      set('error', 'Run the stage first before asking follow-up questions.');
      return;
    }
    await operation('followup', 'api/threads/send', { id, message }, (thread) => {
      editor.actions.acceptThread(decodeThread(thread));
      set('followup', '');
    });
  }

  async function openReviewReference(target: {
    path: string;
    line?: number;
    end?: number;
  }): Promise<void> {
    set('returnTo', {
      path: target.path,
      line: target.line || 1,
      title: active()?.def.title || 'Review',
    });
    await editor.actions.openFile(target.path, { line: target.line || 1 });
    if (target.end)
      app.actions.setNavigation({
        reference: { path: target.path, l1: target.line || 1, l2: target.end },
      });
  }

  onCleanup(() => {
    disposed = true;
    statusController?.abort();
    for (const controller of controllers) controller.abort();
    if (state.mode === 'review') app.actions.setWorkspaceTopic('review', false);
  });

  return {
    state,
    stages,
    active,
    running,
    walkthrough,
    // A failed resource throws on read; views take its error separately.
    walkthroughData: () => (walkthrough.error ? null : walkthrough.latest),
    actions: {
      setReviewMode,
      toggleReviewMode: () => setReviewMode(state.mode === 'review' ? 'code' : 'review'),
      loadReview,
      runReview,
      stopReview: () =>
        operation('stop', 'api/review-workflow/stop', {}, (reply) =>
          acceptRun(decodeReviewStatus(reply).run),
        ),
      saveStage,
      mutateStage,
      sendReviewFollowup,
      openReviewReference,
      setReviewLayout(layout: string): void {
        const next = layout === 'horizontal' ? 'horizontal' : 'vertical';
        set('layout', next);
        localStorage.setItem(LAYOUT_KEY, next);
      },
      setReviewTab: (tab: string) => set('tab', tab === 'stages' ? 'stages' : 'walkthrough'),
      selectReviewStage: (index: number) => set({ active: index, edit: null }),
      openStageEditor(index = state.active) {
        const def = state.config.stages[index];
        set({
          edit: { index: def ? index : -1, value: def ? { ...def } : emptyStage() },
          error: '',
        });
      },
      setStageField: (key: keyof StageDraft, value: string | boolean): void => {
        if (!state.edit) return;
        if (key === 'passPreviousContext' && typeof value === 'boolean')
          set('edit', 'value', key, value);
        else if (key !== 'passPreviousContext' && typeof value === 'string')
          set('edit', 'value', key, value);
      },
      cancelStageEditor: () => set('edit', null),
      renameReview(name: string): Promise<unknown> | void {
        const trimmed = name.trim();
        if (trimmed && trimmed !== state.config.name)
          return saveConfig({ ...state.config, name: trimmed });
      },
      setReviewFollowup: (value: string) => set('followup', value),
      refreshWalkthrough: () => setRevision((value) => value + 1),
      setInsightFilter: (filter: string) => set('filter', filter),
      setWalkthroughViewed: (path: string, viewed: boolean) => set('viewed', path, viewed),
      setActiveWalkthroughFile: (path: string) => set('activeFile', path),
      revealWalkthrough(path: string, line = 0): void {
        set({ activeFile: path, target: { path, line, sequence: state.target.sequence + 1 } });
      },
      dismissReviewReturn: () => set('returnTo', null),
      clearReviewError: () => set('error', ''),
    },
  };
}
