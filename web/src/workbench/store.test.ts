import type { Request } from '../lib/api.ts';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { record } from '../lib/decode.ts';
import { createWorkbenchStore } from './store.ts';

const entries = Array.from({ length: 22 }, (_, i) => ({
  name: `folder-${i}`,
  path: `/code/${i}`,
  git: false,
}));
const directory = { path: '/code', parent: '/', git: false, entries };
const disposers: (() => void)[] = [];
function fixture(
  preview: Request = async (_url, params) => {
    const path = String(record(params).path);
    return { path, entries: [{ name: 'child', path: `${path}/child` }] };
  },
) {
  const request = vi.fn<Request>(async (url, params) =>
    record(params).path === '/code' ? directory : preview(url, params),
  );
  const post = vi.fn<Request>(async () => ({ path: '/code/0' }));
  const store = createRoot((dispose) => {
    disposers.push(dispose);
    return { ...createWorkbenchStore(request, post, vi.fn()), dispose };
  });
  return { ...store, request, post };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
});

test('entering leaves entries unselected unless a path is explicitly selected', async () => {
  const { actions, state, request } = fixture();
  await actions.browse('/code');
  expect(state.selected).toBe(-1);
  expect(state.preview.path).toBe('');
  await vi.advanceTimersByTimeAsync(80);
  expect(request).toHaveBeenCalledTimes(1);
  actions.selectDirectory(3);
  await actions.browse('/code/3');
  expect(state.selected).toBe(-1);
  expect(state.preview.path).toBe('');
  await actions.browse('/code', '/code/3');
  expect(state.selected).toBe(3);
  expect(state.preview.path).toBe('/code/3');
  await actions.browse('/code', '/missing');
  expect(state.selected).toBe(-1);
  expect(state.preview.path).toBe('');
});

test('parent navigation restores selection without a caller-provided index', async () => {
  const { actions, state } = fixture(async (_url, params) => ({
    path: record(params).path,
    parent: '/code',
    entries: [{ name: 'child', path: `${String(record(params).path)}/child` }],
  }));
  await actions.browse('/code');
  await actions.browse('/code/4');
  await actions.browse(state.directory.parent);
  expect(state.directory.path).toBe('/code');
  expect(state.selected).toBe(4);
  expect(state.preview.path).toBe('/code/4');
});

test('empty folders clear selection and cancel the previous preview', async () => {
  const { actions, state, request } = fixture(async (_url, params) => ({
    path: record(params).path,
    parent: '/code',
    entries: [],
  }));
  await actions.browse('/code');
  actions.selectDirectory(0);
  await actions.browse('/code/empty');
  await vi.advanceTimersByTimeAsync(80);
  expect(state.selected).toBe(-1);
  expect(state.preview).toEqual({ path: '', entries: [], busy: false, error: '' });
  expect(request).toHaveBeenCalledTimes(2);
});

test('a stale browse cannot replace a newer folder or select one of its children', async () => {
  let resolveOld: (value: unknown) => void = () => {};
  const { actions, state } = fixture(async (_url, params) =>
    record(params).path === '/old'
      ? new Promise((resolve) => {
          resolveOld = resolve;
        })
      : { path: '/new', entries: [{ name: 'child', path: '/new/child' }] },
  );
  const old = actions.browse('/old');
  await actions.browse('/new');
  resolveOld({ path: '/old', entries: [{ name: 'stale', path: '/old/stale' }] });
  await old;
  expect(state.directory.path).toBe('/new');
  expect(state.selected).toBe(-1);
  expect(state.preview.path).toBe('');
});

test('entering keeps Open on the current folder until an explicit selection', async () => {
  const { state, actions, openEntry } = fixture();
  await actions.browse('/code');
  expect(state.selected).toBe(-1);
  expect(state.preview.path).toBe('');
  expect(openEntry()).toBeUndefined();
  actions.selectDirectory(1);
  expect(openEntry()?.path).toBe('/code/1');
  await actions.browse('/code/1');
  expect(state.selected).toBe(-1);
  expect(state.preview.path).toBe('');
  expect(openEntry()).toBeUndefined();
  actions.selectDirectory(0);
  expect(openEntry()?.path).toBe('/code/1/child');
  actions.selectDirectory(-1);
  expect(openEntry()).toBeUndefined();
});

test.each(['navigation', 'user'] as const)(
  'hidden refresh preserves a %s selection and its Open target',
  async (source) => {
    const { state, actions, openEntry } = fixture();
    await actions.browse('/code');
    if (source === 'user') actions.selectDirectory(2);
    await actions.toggleHidden();
    expect(state.selectionSource).toBe(source);
    expect(state.selected).toBe(source === 'user' ? 2 : -1);
    expect(openEntry()?.path).toBe(source === 'user' ? '/code/2' : undefined);
  },
);

test('creating a folder makes it the explicit Open target', async () => {
  const { actions, openEntry } = fixture();
  await actions.browse('/code');
  expect(openEntry()).toBeUndefined();
  await actions.mkdir('0');
  expect(openEntry()?.path).toBe('/code/0');
});

test('preview debounces selection by 80ms, requests the selected path, and preserves browsing state', async () => {
  const { state, actions, request } = fixture();
  await actions.browse('/code');
  actions.selectDirectory(0);
  await vi.advanceTimersByTimeAsync(40);
  actions.selectDirectory(1);
  await vi.advanceTimersByTimeAsync(79);
  expect(request).toHaveBeenCalledTimes(1);
  expect(state.preview).toMatchObject({ path: '/code/1', busy: true, entries: [] });
  await vi.advanceTimersByTimeAsync(1);
  expect(request).toHaveBeenLastCalledWith('api/wb/browse', { path: '/code/1', hidden: undefined });
  expect(state.preview).toMatchObject({
    path: '/code/1',
    busy: false,
    entries: [{ name: 'child' }],
  });
  expect(state.directory).toEqual(directory);
  expect(state.selected).toBe(1);
});

test('cached previews are keyed by path and selecting the same path does not refetch', async () => {
  const { state, actions, request } = fixture();
  await actions.browse('/code');
  actions.selectDirectory(0);
  await vi.advanceTimersByTimeAsync(80);
  actions.selectDirectory(1);
  await vi.advanceTimersByTimeAsync(80);
  actions.selectDirectory(0);
  expect(state.preview.path).toBe('/code/0');
  expect(state.preview.busy).toBe(false);
  actions.selectDirectory(0);
  await vi.advanceTimersByTimeAsync(80);
  expect(request).toHaveBeenCalledTimes(3);
  expect(state.preview.entries[0]?.path).toBe('/code/0/child');
});

test('preview ignores stale successes and failures, including before the next debounce fires', async () => {
  let resolveOld: (value: unknown) => void = () => {};
  let rejectOld: (error: Error) => void = () => {};
  const pending = new Map<string, Promise<unknown>>([
    [
      '/code/0',
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    ],
    [
      '/code/1',
      new Promise((_resolve, reject) => {
        rejectOld = reject;
      }),
    ],
  ]);
  const { state, actions } = fixture(
    async (_url, params) => pending.get(String(record(params).path)) || { entries: [] },
  );
  await actions.browse('/code');
  actions.selectDirectory(0);
  await vi.advanceTimersByTimeAsync(80);
  actions.selectDirectory(1);
  resolveOld({ entries: [{ name: 'stale', path: '/old' }] });
  await vi.advanceTimersByTimeAsync(80);
  expect(state.preview.path).toBe('/code/1');
  expect(state.preview.entries).toEqual([]);
  actions.selectDirectory(2);
  rejectOld(new Error('stale error'));
  await vi.advanceTimersByTimeAsync(80);
  expect(state.preview).toEqual({ path: '/code/2', entries: [], busy: false, error: '' });
  expect(state.error).toBe('');
  expect(state.directory).toEqual(directory);
  expect(state.selected).toBe(2);
});

test('deselection clears the preview and cancels pending work', async () => {
  const { state, actions, request } = fixture();
  await actions.browse('/code');
  actions.selectDirectory(0);
  actions.selectDirectory(-1);
  await vi.advanceTimersByTimeAsync(80);
  expect(request).toHaveBeenCalledTimes(1);
  expect(state.preview.path).toBe('');
  expect(state.preview).toEqual({ path: '', entries: [], busy: false, error: '' });
  expect(state.selected).toBe(-1);
});

test('hidden toggle invalidates all cached paths and requests previews with the hidden setting', async () => {
  const { state, actions, request } = fixture();
  await actions.browse('/code');
  for (const index of [0, 1]) {
    actions.selectDirectory(index);
    await vi.advanceTimersByTimeAsync(80);
  }
  await actions.toggleHidden();
  await vi.advanceTimersByTimeAsync(80);
  expect(state.selected).toBe(1);
  expect(request).toHaveBeenLastCalledWith('api/wb/browse', { path: '/code/1', hidden: '1' });
  actions.selectDirectory(0);
  await vi.advanceTimersByTimeAsync(80);
  expect(request).toHaveBeenLastCalledWith('api/wb/browse', { path: '/code/0', hidden: '1' });
  expect(request).toHaveBeenCalledTimes(6);
});

test('mkdir invalidates cached paths and previews the newly selected folder', async () => {
  const { state, actions, request, post } = fixture();
  await actions.browse('/code');
  for (const index of [0, 1]) {
    actions.selectDirectory(index);
    await vi.advanceTimersByTimeAsync(80);
  }
  expect(await actions.mkdir('0')).toBe(true);
  expect(post).toHaveBeenCalledWith('api/wb/mkdir', { path: '0', base: '/code' });
  await vi.advanceTimersByTimeAsync(80);
  expect(state.selected).toBe(0);
  expect(request).toHaveBeenLastCalledWith('api/wb/browse', { path: '/code/0', hidden: undefined });
  actions.selectDirectory(1);
  await vi.advanceTimersByTimeAsync(80);
  expect(request).toHaveBeenCalledTimes(6);
});

test.each(['toggleHidden', 'mkdir'] as const)(
  '%s drops a preview already in flight',
  async (action) => {
    let resolveOld: (value: unknown) => void = () => {};
    const { state, actions } = fixture(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    await actions.browse('/code');
    actions.selectDirectory(0);
    await vi.advanceTimersByTimeAsync(80);
    const old = resolveOld;
    if (action === 'mkdir') await actions.mkdir('0');
    else await actions.toggleHidden();
    old({ entries: [{ name: 'stale', path: '/stale' }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(state.preview.entries).toEqual([]);
    expect(state.preview.busy).toBe(true);
  },
);

test('cache keeps at most 20 paths and updates recency on a cache hit', async () => {
  const { actions, request } = fixture();
  await actions.browse('/code');
  for (let index = 0; index < 20; index++) {
    actions.selectDirectory(index);
    await vi.advanceTimersByTimeAsync(80);
  }
  actions.selectDirectory(0);
  actions.selectDirectory(20);
  await vi.advanceTimersByTimeAsync(80);
  actions.selectDirectory(0);
  expect(request).toHaveBeenCalledTimes(22);
  actions.selectDirectory(1);
  await vi.advanceTimersByTimeAsync(80);
  expect(request).toHaveBeenCalledTimes(23);
});

test('preview failures stay local and selecting again retries the request', async () => {
  const preview = vi
    .fn<Request>()
    .mockRejectedValueOnce(new Error('Cannot read folder'))
    .mockResolvedValue({ entries: [] });
  const { state, actions } = fixture(preview);
  await actions.browse('/code');
  actions.selectDirectory(0);
  await vi.advanceTimersByTimeAsync(80);
  expect(state.preview.error).toBe('Cannot read folder');
  expect(state.preview.busy).toBe(false);
  expect(state.error).toBe('');
  expect(state.directory).toEqual(directory);
  expect(state.selected).toBe(0);
  actions.selectDirectory(0);
  await vi.advanceTimersByTimeAsync(80);
  expect(state.preview.error).toBe('');
  expect(preview).toHaveBeenCalledTimes(2);
});

test('disposing the store cancels a pending preview', async () => {
  const { actions, request, dispose } = fixture();
  await actions.browse('/code');
  actions.selectDirectory(0);
  dispose();
  await vi.advanceTimersByTimeAsync(80);
  expect(request).toHaveBeenCalledTimes(1);
});
