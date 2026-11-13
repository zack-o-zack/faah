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
import { api, apiPostJson } from '../lib/api.js';
import { createResourceRequest } from '../lib/resource-request.js';
import { toast } from '../lib/toast.jsx';
import { createWorkspaceSubscription } from '../workspace/stream.js';
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
} from './logic.js';

const LAYOUT_KEY = 'faah-review-layout';

/**
 * @typedef {Object} ReviewState
 * @property {'code'|'review'} mode
 * @property {'vertical'|'horizontal'} layout
 * @property {'walkthrough'|'stages'} tab
 * @property {{name:string,stages:object[]}} config
 * @property {object|null} run
 * @property {number} active
 * @property {string} pending
 * @property {string} error
 * @property {string} loadingThread
 * @property {{index:number,value:object}|null} edit
 * @property {string} followup
 * @property {string} filter
 * @property {{path:string,line:number,sequence:number}} target
 * @property {string} activeFile
 * @property {Object<string, boolean>} viewed
 * @property {{path:string,line:number,title:string}|null} returnTo
 */
/** @returns {ReviewState} */
function initialState() {
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

export function createReviewStore(editor, options = {}) {
  const app = editor.store;
  const request = options.request || api;
  const post = options.post || apiPostJson;
  const [state, set] = createStore(initialState());
  const [revision, setRevision] = createSignal(1);
  const walkthroughRequest = createResourceRequest(request);
  const controllers = new Set();
  let disposed = false;
  let statusController;
  let nextId = 0;

  const stages = createMemo(() => reviewStages(state.config, state.run));
  const active = () => stages()[state.active] || null;
  const running = () => isRunning(state.run);
  const [walkthrough] = createResource(
    () => state.mode === 'review' && state.tab === 'walkthrough' && revision(),
    () => walkthroughRequest('api/review/walkthrough'),
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
          if (!disposed && error.name !== 'AbortError') set('error', error.message);
        })
        .finally(() => {
          if (!disposed && state.loadingThread === id) set('loadingThread', '');
        });
      onCleanup(release);
    }),
  );

  function acceptRun(run) {
    if (disposed || !run) return;
    set('run', reconcile(run));
  }
  function acceptEvent(name, data) {
    const current = state.run;
    const next = reviewTransition(current, name, data);
    if (next === current) return;
    const samePlan =
      current && next.id === current.id && next.stages.length === current.stages.length;
    if (!samePlan || Array.isArray(data.stages)) return acceptRun(next);
    batch(() => {
      set('run', 'stages', next.activeStage, reconcile(next.stages[next.activeStage]));
      set('run', 'activeStage', next.activeStage);
    });
  }
  for (const name of REVIEW_EVENTS)
    createWorkspaceSubscription(app, 'review:' + name, (data) => acceptEvent(name, data));

  async function owned(path, body) {
    const controller = new AbortController();
    controllers.add(controller);
    try {
      return await post(path, body, { signal: controller.signal });
    } finally {
      controllers.delete(controller);
    }
  }
  async function operation(name, path, body, accept) {
    if (state.pending && state.pending !== 'load') return;
    set({ pending: name, error: '' });
    try {
      const reply = await owned(path, body);
      if (!disposed) accept(reply);
      return reply;
    } catch (error) {
      if (!disposed && error.name !== 'AbortError') set('error', error.message);
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
      const reply = await request('api/review-workflow/status', undefined, {
        signal: controller.signal,
      });
      if (disposed || controller.signal.aborted) return;
      batch(() => {
        if (reply.config) set('config', reconcile(workflowConfig(reply.config)));
        if (reply.run) acceptRun(reply.run);
        if (Number.isInteger(reply.run?.activeStage)) set('active', reply.run.activeStage);
      });
    } catch (error) {
      if (!disposed && !controller.signal.aborted) set('error', error.message);
    } finally {
      if (!disposed && statusController === controller) set('pending', '');
    }
  }

  function setReviewMode(mode) {
    const next = mode === 'review' ? 'review' : 'code';
    if (state.mode === next) return;
    set('mode', next);
    app.actions.setWorkspaceTopic('review', next === 'review');
    if (next === 'review') void loadReview();
    else statusController?.abort();
  }

  function saveConfig(config, accept = () => {}) {
    return operation('config', 'api/review-workflow/config', configRequest(config), (reply) => {
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
      set('error', error.message);
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

  async function mutateStage(index, action) {
    if (running()) {
      set('error', 'Stop the pipeline before changing its stages');
      return;
    }
    let config;
    try {
      config = changeStage(state.config, index, action);
    } catch (error) {
      set('error', error.message);
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
      (reply) => acceptRun(reply.run),
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
      editor.actions.acceptThread(thread);
      set('followup', '');
    });
  }

  async function openReviewReference(target) {
    set('returnTo', {
      path: target.path,
      line: target.line || 1,
      title: active()?.def.title || 'Review',
    });
    await editor.actions.openFile(target.path, { line: target.line || 1 });
    if (target.end)
      app.actions.setNavigation({
        reference: { path: target.path, l1: target.line, l2: target.end },
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
        operation('stop', 'api/review-workflow/stop', {}, (reply) => acceptRun(reply.run)),
      saveStage,
      mutateStage,
      sendReviewFollowup,
      openReviewReference,
      setReviewLayout(layout) {
        const next = layout === 'horizontal' ? 'horizontal' : 'vertical';
        set('layout', next);
        localStorage.setItem(LAYOUT_KEY, next);
      },
      setReviewTab: (tab) => set('tab', tab === 'stages' ? 'stages' : 'walkthrough'),
      selectReviewStage: (index) => set({ active: index, edit: null }),
      openStageEditor(index = state.active) {
        const def = state.config.stages[index];
        set({
          edit: { index: def ? index : -1, value: def ? { ...def } : emptyStage() },
          error: '',
        });
      },
      setStageField: (key, value) => set('edit', 'value', key, value),
      cancelStageEditor: () => set('edit', null),
      renameReview(name) {
        const trimmed = name.trim();
        if (trimmed && trimmed !== state.config.name)
          return saveConfig({ ...state.config, name: trimmed });
      },
      setReviewFollowup: (value) => set('followup', value),
      refreshWalkthrough: () => setRevision((value) => value + 1),
      setInsightFilter: (filter) => set('filter', filter),
      setWalkthroughViewed: (path, viewed) => set('viewed', path, viewed),
      setActiveWalkthroughFile: (path) => set('activeFile', path),
      revealWalkthrough(path, line = 0) {
        set({ activeFile: path, target: { path, line, sequence: state.target.sequence + 1 } });
      },
      dismissReviewReturn: () => set('returnTo', null),
      clearReviewError: () => set('error', ''),
    },
  };
}
