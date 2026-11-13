import { createRoot } from 'solid-js';
import { expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { createThreadStore } from './store.js';
import { threadFileOptions } from './logic.js';
function fixture(request = vi.fn(), post = vi.fn()) {
  let dispose, threads;
  const events = new Map();
  createRoot((release) => {
    dispose = release;
    const app = createAppStore();
    app.actions.subscribeWorkspaceEvent = (name, handler) => {
      events.set(name, handler);
      return () => events.delete(name);
    };
    const editor = {
      store: app,
      active: () => null,
      tree: { scope: () => 'all' },
      actions: {
        ...app.actions,
        setSelection: vi.fn(),
        orbThread: vi.fn(),
        orbSummary: vi.fn(),
        orbStep: vi.fn(),
        reloadWorkspace: vi.fn().mockResolvedValue(),
      },
    };
    threads = createThreadStore(editor, { request, post });
  });
  return { threads, events, dispose };
}
test('stream deltas update only the matching turn and preserve older transcript identity', () => {
  const { threads, events, dispose } = fixture();
  threads.actions.acceptThread({
    id: 'one',
    turns: [
      { id: 1, reply: 'complete' },
      { id: 2, reply: 'new', running: true },
    ],
  });
  const first = threads.state.records.one.turns[0];
  events.get('thread:delta')({ id: 'one', data: { turn: 2, text: ' tail' } });
  events.get('thread:tool')({ id: 'one', data: { turn: 2, text: 'Read source' } });
  expect(threads.state.records.one.turns[0]).toBe(first);
  expect(first.reply).toBe('complete');
  expect(threads.state.records.one.turns[1].reply).toBe('new tail');
  expect(threads.state.records.one.turns[1].tools).toEqual(['Read source']);
  dispose();
  expect(events.size).toBe(0);
});
test('late opens cannot select an old thread and disposal aborts pending requests', async () => {
  const pending = [];
  const request = vi.fn(
    (_, params, options) =>
      new Promise((resolve) => pending.push({ ...params, ...options, resolve })),
  );
  const { threads, dispose } = fixture(request);
  const one = threads.actions.openThread('one');
  const two = threads.actions.openThread('two');
  pending[1].resolve({ id: 'two', turns: [] });
  await two;
  pending[0].resolve({ id: 'one', turns: [] });
  await one;
  expect(threads.state.current).toBe('two');
  const three = threads.actions.openThread('three');
  dispose();
  expect(pending[2].signal.aborted).toBe(true);
  pending[2].resolve({ id: 'three', turns: [] });
  await three;
});
test('turn diffs stay frozen at the before and after snapshots until reverted', () => {
  expect(
    threadFileOptions({ beforeSha: 'a', afterSha: 'b', changed: ['one.js'], id: 2 }),
  ).toMatchObject({ ref: 'b', base: 'a', view: 'diff', turnFiles: ['one.js'] });
  expect(threadFileOptions({ beforeSha: 'a', afterSha: 'b', reverted: true })).toBeUndefined();
});
