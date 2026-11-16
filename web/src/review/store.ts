import type { AppStore } from '../app/store.ts';
import type { Request } from '../lib/api.ts';
import type { CoreActions } from '../editor/contracts.ts';
import type { StageDraft, ReviewRun, ReviewConfig, ReviewEvent } from './types.ts';
import { decodeReviewEvent, decodeReviewStatus, decodeWalkthrough } from './decode.ts';
import type { PROverview } from '../pr/types.ts';
import { decodeOverview } from '../pr/decode.ts';
import { decodeThread } from '../threads/decode.ts';
import { isAbort, errorMessage } from '../lib/decode.ts';
import { record, list, number, text } from '../lib/decode.ts';
import {
  missingLines,
  mergeRanges,
  withContext,
  type ContextLine,
  type ContextRange,
} from './context.ts';
export interface ReviewOptions {
  request?: Request;
  post?: Request;
}
interface ReviewState {
  mode: 'code' | 'review';
  layout: 'vertical' | 'horizontal';
  tab: 'overview' | 'walkthrough' | 'stages';
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
  context: Record<string, Record<number, ContextLine>>;
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
import { toast } from '../lib/toast.tsx';
import { createWorkspaceSubscription } from '../workspace/stream.ts';
import {
  REVIEW_EVENTS,
  activeGroupFilter,
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
    tab: 'overview',
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
    context: {},
    returnTo: null,
  };
}

export function createReviewStore(
  editor: ReviewHost,
  options: ReviewOptions = {},
): ReturnType<typeof buildReviewStore> {
  return buildReviewStore(editor, options);
}
function buildReviewStore(editor: ReviewHost, options: ReviewOptions = {}) {
  const app = editor.store;
  const request = options.request || api;
  const post = options.post || apiPostJson;
  const [state, set] = createStore(initialState());
  const [revision, setRevision] = createSignal(1);
  const walkthroughRequest = createResourceRequest(request);
  const overviewRequest = createResourceRequest(request);
  const controllers = new Set<AbortController>();
  let disposed = false;
  let statusController: AbortController | undefined;
  let nextId = 0;
  let contextHead = '';
  const [contextEpoch, setContextEpoch] = createSignal(0);
  const contextRequests = new Map<
    string,
    { controller: AbortController; promise: Promise<boolean> }
  >();
  const contextTotals = new Map<string, number>();
  const contextMaps = new Map<string, ReadonlyMap<number, ContextLine>>();
  function clearContext() {
    for (const pending of contextRequests.values()) pending.controller.abort();
    contextRequests.clear();
    contextTotals.clear();
    contextMaps.clear();
    batch(() => {
      set('context', reconcile({}));
      setContextEpoch((epoch) => epoch + 1);
    });
  }

  const stages = createMemo(() => reviewStages(state.config, state.run));
  const active = () => stages()[state.active] || null;
  const running = () => isRunning(state.run);
  const needsWalkthrough = createMemo(
    () =>
      state.mode === 'review' &&
      (state.tab === 'walkthrough' || app.state.explanation.walk?.surface === 'review') &&
      !!app.state.workspace.meta?.pr,
  );
  const [walkthrough] = createResource(
    () =>
      needsWalkthrough() && {
        revision: revision(),
        head: app.state.workspace.meta?.pr?.headSHA,
        ignoreWhitespace: app.settings.value('diffEditor.ignoreWhitespace') === true,
      },
    async ({ ignoreWhitespace }) => {
      const data = decodeWalkthrough(
        await walkthroughRequest(
          'api/review/walkthrough' + (ignoreWhitespace ? '?ignoreWhitespace=1' : ''),
        ),
      );
      if (contextHead !== data.headRef) {
        contextHead = data.headRef;
        clearContext();
      }
      return data;
    },
  );
  createEffect(on(() => app.state.workspace.meta?.pr?.headSHA, clearContext));
  const reviewFiles = createMemo(() => {
    contextEpoch();
    return (walkthrough.error ? [] : walkthrough.latest?.files || []).map((file) => {
      const entries = Object.entries(state.context[file.path] || {}).map(
        ([line, value]) => [Number(line), { text: value.text, html: value.html }] as const,
      );
      let extra = contextMaps.get(file.path);
      if (
        !extra ||
        extra.size !== entries.length ||
        entries.some(
          ([line, value]) =>
            extra?.get(line)?.text !== value.text || extra?.get(line)?.html !== value.html,
        )
      ) {
        extra = new Map(entries);
        contextMaps.set(file.path, extra);
      }
      return withContext(file, extra);
    });
  });

  async function expandReviewContext(path: string, ranges: ContextRange[]): Promise<boolean> {
    if (disposed) return false;
    const file = reviewFiles().find((file) => file.path === path && file.status !== 'D');
    if (!file) return false;
    const epoch = contextEpoch();
    const total = contextTotals.get(path) ?? Infinity;
    const unloaded = mergeRanges(
      ranges.flatMap((range) =>
        missingLines(file, Math.max(1, range.from), Math.min(total, range.to), 0),
      ),
    );
    const requests: Promise<boolean>[] = [];
    for (const range of unloaded) {
      for (let from = range.from; from <= range.to; from += 2000) {
        const to = Math.min(range.to, from + 1999);
        const key = JSON.stringify([epoch, path, from, to]);
        const pending = contextRequests.get(key);
        if (pending) {
          requests.push(pending.promise);
          continue;
        }
        const controller = new AbortController();
        const promise = (async () => {
          try {
            const reply = record(
              await request(
                'api/review/context',
                { path, from, to },
                { signal: controller.signal },
              ),
            );
            if (disposed || controller.signal.aborted || contextEpoch() !== epoch) return false;
            if (text(reply.path) !== path) throw new Error('Unexpected context path');
            const rows = Object.fromEntries(
              list(reply.rows).map((value) => {
                const row = record(value);
                return [number(row.line), { text: text(row.text), html: text(row.html) }];
              }),
            );
            contextTotals.set(path, number(reply.total));
            set('context', path, { ...state.context[path], ...rows });
            return true;
          } catch (error) {
            if (
              !disposed &&
              !controller.signal.aborted &&
              contextEpoch() === epoch &&
              !isAbort(error)
            )
              toast('error', `Cannot expand context: ${errorMessage(error)}`);
            return false;
          } finally {
            if (contextRequests.get(key)?.controller === controller) contextRequests.delete(key);
          }
        })();
        contextRequests.set(key, { controller, promise });
        requests.push(promise);
      }
    }
    return (await Promise.all(requests)).every(Boolean) && !disposed && contextEpoch() === epoch;
  }
  const [overview, { refetch: refetchOverview }] = createResource(
    () =>
      state.mode === 'review' &&
      !!app.state.workspace.meta?.pr &&
      (app.state.workspace.meta.pr.headSHA || 'head'),
    async (_source, info): Promise<PROverview> => {
      const next = decodeOverview(
        await overviewRequest(
          'api/pr/overview' + (info.refetching === 'refresh' ? '?refresh=1' : ''),
        ),
      );
      const previous = new Map(info.value?.checks.map((check) => [check.id, check]));
      next.checks = next.checks.map((check) => {
        const old = previous.get(check.id);
        return old && old.name === check.name && old.state === check.state && old.url === check.url
          ? old
          : check;
      });
      return next;
    },
  );
  createEffect(
    on(
      () => state.tab,
      (tab) => {
        if (tab === 'overview' && state.mode === 'review' && overview.state !== 'unresolved')
          void refetchOverview();
      },
      { defer: true },
    ),
  );
  // Leaving the PR context closes its review and releases the review subscription.
  createEffect(
    on(
      () => !!app.state.workspace.meta?.pr,
      (isPR) => {
        if (!isPR) setReviewMode('code');
      },
    ),
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
    if (next === 'review' && !app.state.workspace.meta?.pr) return;
    if (state.mode === next) return;
    batch(() => {
      set('mode', next);
      if (next === 'review') set('tab', 'overview');
    });
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
    for (const pending of contextRequests.values()) pending.controller.abort();
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
    reviewFiles,
    contextEpoch,
    overview,
    overviewData: () => (overview.error ? null : overview.latest),
    groupFilter: () =>
      activeGroupFilter(walkthrough.error ? [] : walkthrough.latest?.files || [], state.filter),
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
      expandReviewContext,
      setReviewLayout(layout: string): void {
        const next = layout === 'horizontal' ? 'horizontal' : 'vertical';
        set('layout', next);
        localStorage.setItem(LAYOUT_KEY, next);
      },
      setReviewTab: (tab: string) =>
        set('tab', tab === 'stages' || tab === 'walkthrough' ? tab : 'overview'),
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
      refreshReview: () => {
        clearContext();
        setRevision((value) => value + 1);
        void refetchOverview('refresh');
      },
      setGroupFilter: (filter: string) => set('filter', filter),
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
