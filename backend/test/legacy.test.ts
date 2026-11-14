import { test, expect } from 'bun:test';
import {
  LegacyNavigation,
  gitState,
  gitMutations,
  fileMutations,
} from '../src/legacy/navigation.ts';
import { emptyGit, type GitState } from '../src/index/types.ts';

function adapter() {
  let current: GitState = emptyGit(),
    refreshes = 0,
    rebuilds = 0,
    subscriptions = 0;
  const applied: GitState[] = [],
    touched: string[] = [];
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/prefix/api/meta')
        return Response.json({ ready: true, agentModel: String(refreshes) });
      if (path === '/prefix/api/git/refresh') {
        refreshes++;
        return Response.json(current);
      }
      if (path === '/prefix/api/git/stream') {
        subscriptions++;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              stream = controller;
            },
            cancel() {
              stream = undefined;
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      }
      return new Response(null, { status: 404 });
    },
  });
  const legacy = new LegacyNavigation({
    origin: `http://127.0.0.1:${server.port}`,
    base: '/prefix/',
    apply: async (state) => {
      await Bun.sleep(1);
      applied.push(state);
    },
    rebuild: async () => {
      rebuilds++;
    },
    touch: async (path) => {
      touched.push(path);
    },
  });
  return {
    legacy,
    applied,
    touched,
    get refreshes() {
      return refreshes;
    },
    get rebuilds() {
      return rebuilds;
    },
    get subscriptions() {
      return subscriptions;
    },
    set(state: GitState) {
      current = state;
    },
    emit(state: GitState) {
      stream?.enqueue(Buffer.from('event: git-status\ndata: ' + JSON.stringify(state) + '\n\n'));
    },
    async close() {
      await legacy.close();
      await server.stop(true);
    },
  };
}
async function until(ready: () => boolean) {
  const deadline = performance.now() + 2000;
  while (!ready()) {
    if (performance.now() > deadline) throw new Error('adapter did not settle');
    await Bun.sleep(1);
  }
}

test('legacy Git mutations apply payload or refresh before returning, including failed mutations', async () => {
  const f = adapter();
  try {
    const state = {
      ...emptyGit(),
      git: true,
      statuses: { 'file.go': 'M' },
      staged: { 'file.go': true },
    };
    for (const route of gitMutations) {
      const response = Response.json(state);
      await f.legacy.after({ route, response });
      expect(f.applied.at(-1)).toEqual(state);
      expect(await response.json()).toEqual(state);
    }
    f.set(state);
    const previous = f.refreshes;
    await f.legacy.after({ route: 'api/git/commit', response: Response.json({ ok: true }) });
    expect(f.refreshes).toBe(previous + 1);
    expect(f.applied.at(-1)).toEqual(state);
    await f.legacy.after({
      route: 'api/git/pull',
      response: Response.json({ error: 'conflict' }, { status: 409 }),
    });
    expect(f.refreshes).toBe(previous + 2);
  } finally {
    await f.close();
  }
});

test('legacy file writes touch and refresh; agent/thread/workflow routes rebuild', async () => {
  const f = adapter();
  try {
    for (const route of ['api/file/save', 'api/fs/new'])
      await f.legacy.after({ route, path: 'sub/new.go', response: Response.json({ ok: true }) });
    expect(f.touched).toEqual(['sub/new.go', 'sub/new.go']);
    expect(f.refreshes).toBe(2);
    for (const route of fileMutations)
      await f.legacy.after({ route, response: Response.json({ ok: true }) });
    expect(f.rebuilds).toBe(fileMutations.size);
    const previous = f.rebuilds;
    await f.legacy.after({
      route: 'api/threads/revert',
      response: Response.json({ error: 'gone' }, { status: 404 }),
    });
    expect(f.rebuilds).toBe(previous);
  } finally {
    await f.close();
  }
});

test('one internal Git subscription applies every status and rebuilds after async agent writes', async () => {
  const f = adapter();
  try {
    f.legacy.start();
    f.legacy.start();
    await until(() => f.subscriptions === 1);
    const state = { ...emptyGit(), git: true, statuses: { 'new.go': 'U' } };
    f.emit(state);
    await until(() => f.applied.length === 1);
    expect(f.applied[0]).toEqual(state);
    await f.legacy.after({ route: 'api/threads/send', response: Response.json({ ok: true }) });
    const previous = f.rebuilds;
    f.emit(state);
    await until(() => f.rebuilds > previous);
    expect(f.subscriptions).toBe(1);
  } finally {
    await f.close();
  }
});

test('legacy status decoder rejects malformed maps', () => {
  for (const value of [
    null,
    {},
    { git: 'true' },
    { git: true, statuses: { x: 4 } },
    { git: true, partial: { x: 'yes' } },
  ])
    expect(() => gitState(value)).toThrow();
  expect(gitState({ git: false, statuses: null })).toEqual(emptyGit());
});
