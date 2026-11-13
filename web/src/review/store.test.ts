import type { ReviewOptions } from './store.ts';
import type { StreamHandler } from '../lib/events.ts';
import { required } from '../lib/test-values.ts';
import { createRoot } from 'solid-js';
import { expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { createReviewStore } from './store.ts';

const def = (id: string) => ({ id, title: id, question: 'Why?', prompt: 'Look' });
function fixture(options: ReviewOptions = {}) {
  const subscribers = new Map<string, StreamHandler>();
  return createRoot((dispose) => {
    const app = createAppStore();
    app.actions.subscribeWorkspaceEvent = (name, handler) => {
      subscribers.set(name, handler);
      return () => {
        subscribers.delete(name);
      };
    };
    app.actions.setWorkspaceTopic = vi.fn();
    app.actions.watchWorkspaceThread = vi.fn(() => vi.fn());
    const editor = {
      store: app,
      actions: {
        loadThread: vi.fn(async (id: string) => ({ id, turns: [] })),
        acceptThread: vi.fn(),
        openFile: vi.fn(async () => {}),
      },
    };
    const review = createReviewStore(editor, options);
    const emit = (name: string, data: unknown) => required(subscribers.get('review:' + name))(data);
    return { review, app, dispose, emit };
  });
}
const reply = () => structuredClone(statusReply);
const statusReply = {
  config: { name: 'P', stages: [def('a'), def('b')] },
  run: {
    id: 'r1',
    status: 'running',
    activeStage: 1,
    stages: [
      { def: def('a'), status: 'completed', threadId: 't1' },
      { def: def('b'), status: 'running' },
    ],
  },
};

test('entering review loads status, turns on the topic and selects the active stage', async () => {
  const request = vi.fn(async () => reply());
  const { review, app, dispose } = fixture({ request });
  review.actions.setReviewMode('review');
  await vi.waitFor(() => expect(review.state.pending).toBe(''));
  expect(app.actions.setWorkspaceTopic).toHaveBeenCalledWith('review', true);
  expect(review.state.active).toBe(1);
  expect(review.running()).toBe(true);
  review.actions.toggleReviewMode();
  expect(review.state.mode).toBe('code');
  expect(app.actions.setWorkspaceTopic).toHaveBeenLastCalledWith('review', false);
  dispose();
});

test('stage events update one stage by path and keep the others', async () => {
  const { review, dispose, emit } = fixture({ request: async () => reply() });
  review.actions.setReviewMode('review');
  await vi.waitFor(() => expect(review.state.run).not.toBe(null));
  const first = required(review.state.run).stages[0];
  emit('stage_completed', {
    runId: 'r1',
    stageIndex: 1,
    stage: { def: def('b'), status: 'completed', threadId: 't2' },
  });
  expect(review.stages()[1]?.status).toBe('completed');
  expect(required(review.state.run).stages[0]).toBe(first);
  emit('run_completed', { ...reply().run, status: 'completed' });
  expect(review.running()).toBe(false);
  dispose();
});

test('the stage on screen follows its thread only while the pipeline tab shows', async () => {
  const { review, app, dispose } = fixture({ request: async () => reply() });
  review.actions.setReviewMode('review');
  await vi.waitFor(() => expect(review.state.run).not.toBe(null));
  review.actions.selectReviewStage(0);
  expect(app.actions.watchWorkspaceThread).not.toHaveBeenCalled();
  review.actions.setReviewTab('stages');
  expect(app.actions.watchWorkspaceThread).toHaveBeenCalledWith('t1');
  const release = required(vi.mocked(app.actions.watchWorkspaceThread).mock.results[0]).value;
  review.actions.setReviewTab('walkthrough');
  expect(release).toHaveBeenCalled();
  dispose();
});

test('editing saves through named actions and refuses structural changes while running', async () => {
  const post = vi.fn(async (_path: string, body: unknown) => ({ config: body }));
  const { review, dispose } = fixture({ request: async () => reply(), post });
  review.actions.setReviewMode('review');
  await vi.waitFor(() => expect(review.state.run).not.toBe(null));
  await review.actions.mutateStage(0, 'down');
  expect(review.state.error).toMatch(/Stop the pipeline/);
  review.actions.openStageEditor(-1);
  review.actions.setStageField('title', 'Security');
  await review.actions.saveStage();
  expect(post).toHaveBeenCalledWith(
    'api/review-workflow/config',
    expect.objectContaining({ activeId: 'standard' }),
    expect.anything(),
  );
  expect(review.state.config.stages.map((stage) => stage.title)).toEqual(['a', 'b', 'Security']);
  expect(review.state.active).toBe(2);
  expect(review.state.edit).toBe(null);
  dispose();
});

test('layout persists and a review reference leaves a way back', async () => {
  const { review, dispose } = fixture();
  review.actions.setReviewLayout('horizontal');
  expect(localStorage.getItem('faah-review-layout')).toBe('horizontal');
  await review.actions.openReviewReference({ path: 'a.go', line: 4 });
  expect(review.state.returnTo).toMatchObject({ path: 'a.go', line: 4 });
  review.actions.dismissReviewReturn();
  expect(review.state.returnTo).toBe(null);
  dispose();
});
