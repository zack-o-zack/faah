import type { RequestOptions } from '../lib/api.ts';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createWorkspaceStream } from './stream.ts';
import { createAppStore } from '../app/store.ts';
import { streamPath, workspacePatch } from './snapshot.ts';
class Source extends EventTarget {
  url: string;
  closed = false;
  constructor(url: string) {
    super();
    this.url = String(url);
    sources.push(this);
  }
  close(): void {
    this.closed = true;
  }
  send(name: string, data: unknown): void {
    this.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(data) }));
  }
}
let sources: Source[];
function source(index = 0): Source {
  const found = sources[index];
  if (!found) throw new Error('Stream did not start');
  return found;
}
const disposers: (() => void)[] = [];
beforeEach(() => {
  sources = [];
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal('EventSource', Source);
});
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function owned<T>(factory: () => T): T {
  return createRoot((dispose) => {
    disposers.push(dispose);
    return factory();
  });
}
test('one stream batches topic changes and reference-counts thread watchers', async () => {
  const stream = owned(() => createWorkspaceStream());
  const receive = vi.fn();
  stream.subscribe('thread:delta', receive);
  stream.start();
  expect(sources.filter((source) => !source.closed)).toHaveLength(1);
  source(0).send('thread:delta', { text: 'first' });
  expect(receive).toHaveBeenCalledWith({ text: 'first' });
  stream.topic('threads', true);
  stream.topic('review', true);
  const release = stream.watch('a/b');
  const second = stream.watch('a/b');
  await vi.runAllTicks();
  expect(sources).toHaveLength(2);
  expect(source(0).closed).toBe(true);
  expect(source(1).url).toContain('threads=1&review=1&thread=a%2Fb');
  release();
  release();
  await vi.runAllTicks();
  expect(sources).toHaveLength(2);
  second();
  await vi.runAllTicks();
  expect(sources).toHaveLength(3);
  expect(sources.filter((source) => !source.closed)).toHaveLength(1);
});
test('native reconnect is retained and disposal releases timers and all listeners', async () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  const stream = owned(() => createWorkspaceStream({ refresh }));
  stream.start();
  source(0).dispatchEvent(new Event('error'));
  expect(source(0).closed).toBe(false);
  source(0).send('ping', {});
  await vi.advanceTimersByTimeAsync(13000);
  expect(sources).toHaveLength(2);
  stream.dispose();
  const count = sources.length;
  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(30000);
  expect(sources).toHaveLength(count);
  expect(vi.getTimerCount()).toBe(0);
  expect(sources.every((source) => source.closed)).toBe(true);
});
test('Git snapshots reconcile metadata and metrics without replacing local document state', () => {
  const app = owned(() => createAppStore());
  app.actions.setWorkspace({ name: 'repo', git: true, pr: { number: 7 } });
  app.actions.startWorkspaceStream();
  source(0).send('git-status', {
    git: true,
    gitChanges: 1,
    gitFiles: ['one.go'],
    branch: 'main',
    ahead: 2,
    statuses: { 'one.go': 'M' },
  });
  expect(app.state.workspace.meta).toMatchObject({
    name: 'repo',
    branch: 'main',
    ahead: 2,
    pr: { number: 7 },
  });
  expect(app.state.git.snapshot?.statuses?.['one.go']).toBe('M');
  source(0).send('metrics', { rssBytes: 1024 });
  expect(app.state.workspace.metrics?.rssBytes).toBe(1024);
  expect(app.state.documents.tabs).toHaveLength(0);
  source(0).send('git-status', { git: true, gitChanges: 0, gitFiles: [], statuses: {} });
  expect(app.state.git.snapshot?.statuses?.['one.go']).toBeUndefined();
});
test('refresh actions deduplicate requests, expose errors and abort on disposal', async () => {
  let reject: ((reason: unknown) => void) | undefined;
  let signal: AbortSignal | undefined;
  const post = vi.fn((_path: string, _params?: unknown, options?: RequestOptions) => {
    signal = options?.signal || undefined;
    return new Promise<unknown>((_resolve, fail) => {
      reject = fail;
    });
  });
  const app = owned(() => createAppStore({ post }));
  app.actions.setWorkspace({ git: true });
  const first = app.actions.refreshWorkspace();
  const second = app.actions.refreshWorkspace();
  expect(post).toHaveBeenCalledOnce();
  expect(app.state.workspace.pending).toBe(true);
  if (!reject) throw new Error('Request did not start');
  reject(new Error('offline'));
  await Promise.all([first, second]);
  expect(app.state.workspace.error).toBe('offline');
  expect(app.state.workspace.pending).toBe(false);
  const last = app.actions.refreshWorkspace();
  disposers.pop()?.();
  expect(signal?.aborted).toBe(true);
  reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  await last;
});
test('request shaping preserves unrelated workspace metadata', () => {
  expect(workspacePatch({ ...{ gitChanges: 0, arbitrary: 'ignored' } })).toEqual({ gitChanges: 0 });
  expect(streamPath({ review: true }, new Map([['thread', 2]]))).toBe(
    'api/stream?review=1&thread=thread',
  );
});
