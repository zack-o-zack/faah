import { prMeta } from '../pr/test-editor.ts';
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
    app.actions.setWorkspace({ git: true, pr: prMeta() });
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

test('a hidden pending walkthrough reloads when its tab is reopened', async () => {
  let finish: ((value: unknown) => void) | undefined;
  const pending = new Promise<unknown>((resolve) => {
    finish = resolve;
  });
  const { review, dispose } = fixture({
    request: async (path) => (path === 'api/review/walkthrough' ? pending : reply()),
  });
  try {
    review.actions.setReviewMode('review');
    review.actions.setReviewTab('walkthrough');
    await vi.waitFor(() => expect(review.walkthrough.loading).toBe(true));
    review.actions.setReviewTab('stages');
    finish?.({ totalFiles: 1, files: [] });
    review.actions.setReviewTab('walkthrough');
    await vi.waitFor(() => expect(review.walkthroughData()?.totalFiles).toBe(1));
  } finally {
    dispose();
  }
});

test('walkthrough refetches with the whitespace query only when enabled', async () => {
  const request = vi.fn<NonNullable<ReviewOptions['request']>>(async () => ({ files: [] }));
  const { review, app, dispose } = fixture({ request });
  review.actions.setReviewMode('review');
  review.actions.setReviewTab('walkthrough');
  await vi.waitFor(() =>
    expect(request.mock.calls.some(([path]) => path === 'api/review/walkthrough')).toBe(true),
  );
  void app.settings.actions.setSetting('diffEditor.ignoreWhitespace', true);
  await vi.waitFor(() =>
    expect(
      request.mock.calls.some(([path]) => path === 'api/review/walkthrough?ignoreWhitespace=1'),
    ).toBe(true),
  );
  request.mockClear();
  void app.settings.actions.setSetting('diffEditor.ignoreWhitespace', false);
  await vi.waitFor(() =>
    expect(request.mock.calls.some(([path]) => path === 'api/review/walkthrough')).toBe(true),
  );
  expect(request.mock.calls.some(([path]) => path.includes('ignoreWhitespace'))).toBe(false);
  dispose();
});

test('local workflows never request review data, even with committed or uncommitted files', async () => {
  const request = vi.fn(async () => reply());
  const { review, app, dispose } = fixture({ request });
  app.actions.setWorkspace({ git: true, gitChanges: 2 });
  app.actions.acceptGitSnapshot({ git: true, statuses: { 'local.go': 'M', 'new.go': 'U' } });
  review.actions.setReviewMode('review');
  review.actions.toggleReviewMode();
  review.actions.refreshReview();
  await Promise.resolve();
  expect(review.state.mode).toBe('code');
  expect(request).not.toHaveBeenCalled();
  expect(app.actions.setWorkspaceTopic).not.toHaveBeenCalled();
  dispose();
});

test('context requests deduplicate, use head rows, and preserve raw counts', async () => {
  let finish: ((value: unknown) => void) | undefined;
  const pending = new Promise<unknown>((resolve) => {
    finish = resolve;
  });
  const request = vi.fn<NonNullable<ReviewOptions['request']>>(async (path) =>
    path === 'api/review/context'
      ? pending
      : {
          ...reply(),
          headRef: 'head',
          totalFiles: 1,
          totalAdditions: 1,
          files: [
            {
              path: 'a.go',
              group: 'core',
              additions: 1,
              hunks: [
                {
                  oldStart: 1,
                  newStart: 1,
                  rows: [{ type: 'ctx', oldLine: 1, newLine: 1, text: 'one' }],
                },
              ],
            },
          ],
        },
  );
  const { review, dispose } = fixture({ request });
  try {
    review.actions.setReviewMode('review');
    review.actions.setReviewTab('walkthrough');
    await vi.waitFor(() => expect(review.reviewFiles()).toHaveLength(1));
    const first = review.actions.expandReviewContext('a.go', [{ from: 2, to: 4 }]);
    const second = review.actions.expandReviewContext('a.go', [{ from: 2, to: 4 }]);
    expect(request.mock.calls.filter(([path]) => path === 'api/review/context')).toHaveLength(1);
    finish?.({
      path: 'a.go',
      total: 3,
      rows: [
        { line: 2, text: 'head two', html: '<i class=k>head</i> two' },
        { line: 3, text: 'three', html: 'three' },
      ],
    });
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    const expanded = review.reviewFiles()[0];
    expect(expanded?.hunks?.[0]?.rows).toHaveLength(3);
    expect(expanded?.hunks?.[0]?.rows[1]).toMatchObject({
      type: 'ctx',
      oldLine: 2,
      newLine: 2,
      text: 'head two',
      html: '<i class=k>head</i> two',
    });
    expect(review.walkthroughData()?.files[0]?.hunks?.[0]?.rows).toHaveLength(1);
    expect(review.walkthroughData()?.totalAdditions).toBe(1);
    expect(review.reviewFiles()[0]).toBe(expanded);
    await review.actions.expandReviewContext('a.go', [{ from: 2, to: 10 }]);
    expect(request.mock.calls.filter(([path]) => path === 'api/review/context')).toHaveLength(1);
  } finally {
    dispose();
  }
});

test.each(['refresh', 'head'] as const)(
  'context drops on %s and stale responses cannot restore it',
  async (change) => {
    let finish: ((value: unknown) => void) | undefined;
    let head = 'first';
    const request = vi.fn<NonNullable<ReviewOptions['request']>>(async (path) => {
      if (path === 'api/review/context')
        return new Promise<unknown>((resolve) => {
          finish = resolve;
        });
      return { ...reply(), headRef: head, files: [{ path: 'a.go', group: 'core', hunks: [] }] };
    });
    const { review, app, dispose } = fixture({ request });
    try {
      review.actions.setReviewMode('review');
      review.actions.setReviewTab('walkthrough');
      await vi.waitFor(() => expect(review.reviewFiles()).toHaveLength(1));
      const first = review.actions.expandReviewContext('a.go', [{ from: 1, to: 1 }]);
      finish?.({ path: 'a.go', total: 2, rows: [{ line: 1, text: 'one', html: 'one' }] });
      await first;
      expect(Object.keys(review.state.context)).toEqual(['a.go']);
      const stale = review.actions.expandReviewContext('a.go', [{ from: 2, to: 2 }]);
      const signal = request.mock.calls
        .filter(([path]) => path === 'api/review/context')
        .at(-1)?.[2]?.signal;
      head = 'next';
      if (change === 'refresh') review.actions.refreshReview();
      else app.actions.setWorkspace({ git: true, pr: { ...prMeta(), headSHA: head } });
      expect(Object.keys(review.state.context)).toEqual([]);
      expect(signal?.aborted).toBe(true);
      finish?.({ path: 'a.go', total: 2, rows: [{ line: 2, text: 'stale', html: 'stale' }] });
      expect(await stale).toBe(false);
      await vi.waitFor(() => expect(review.walkthroughData()?.headRef).toBe('next'));
      expect(Object.keys(review.state.context)).toEqual([]);
      expect(review.reviewFiles()[0]?.hunks).toEqual([]);
    } finally {
      dispose();
    }
  },
);

test('context cleanup aborts requests and cannot publish rows', async () => {
  let finish: ((value: unknown) => void) | undefined;
  const request = vi.fn<NonNullable<ReviewOptions['request']>>(async (path) => {
    if (path === 'api/review/context')
      return new Promise<unknown>((resolve) => {
        finish = resolve;
      });
    return { ...reply(), files: [{ path: 'a.go', group: 'core', hunks: [] }] };
  });
  const { review, dispose } = fixture({ request });
  review.actions.setReviewMode('review');
  review.actions.setReviewTab('walkthrough');
  await vi.waitFor(() => expect(review.reviewFiles()).toHaveLength(1));
  const pending = review.actions.expandReviewContext('a.go', [{ from: 1, to: 1 }]);
  const signal = request.mock.calls.find(([path]) => path === 'api/review/context')?.[2]?.signal;
  dispose();
  expect(signal?.aborted).toBe(true);
  finish?.({ path: 'a.go', total: 1, rows: [{ line: 1, text: 'one', html: 'one' }] });
  expect(await pending).toBe(false);
  expect(Object.keys(review.state.context)).toEqual([]);
});
