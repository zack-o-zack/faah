import { test, expect } from 'bun:test';
import { LegacyFeeds } from '../src/legacy/feeds.ts';
import { eventFrame, eventResponse } from '../src/http/events.ts';
import { headers } from '../src/http/response.ts';
import { WorkspaceStreams } from '../src/http/workspace-streams.ts';
import { GitWorkspace } from '../src/git/workspace.ts';
import { Index } from '../src/index/service.ts';
import { gitFixture } from './git-fixture.ts';
async function until(check: () => boolean) {
  const deadline = performance.now() + 3000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error('stream did not settle');
    await Bun.sleep(5);
  }
}
function upstream() {
  const requests: URLSearchParams[] = [];
  const open = new Set<ReadableStreamDefaultController<Uint8Array>>();
  let peak = 0;
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const query = new URL(request.url).searchParams;
      requests.push(query);
      let current: ReadableStreamDefaultController<Uint8Array> | undefined;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            current = controller;
            open.add(controller);
            peak = Math.max(peak, open.size);
            const send = (event: string, data: unknown) =>
              controller.enqueue(Buffer.from(eventFrame(event, data)));
            send('metrics', { legacy: true });
            send('git-status', { legacy: true });
            controller.enqueue(Buffer.from(': ping\n\n'));
            if (query.get('threads') === '1') send('threads:list', []);
            for (const id of query.getAll('thread'))
              send('thread:thread', { id, data: { id, turns: [] } });
            if (query.get('review') === '1') send('review:snapshot', null);
          },
          cancel() {
            if (current) open.delete(current);
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    },
  });
  return {
    requests,
    open,
    get peak() {
      return peak;
    },
    server,
    emit(event: string, data: unknown) {
      for (const stream of open) stream.enqueue(Buffer.from(eventFrame(event, data)));
    },
    lose() {
      for (const stream of open) stream.close();
      open.clear();
    },
  };
}
test('legacy feeds share one union subscription, deduplicate ids, filter events and replay bounded state', async () => {
  const f = upstream(),
    feeds = new LegacyFeeds(f.server.url.origin, '/');
  const first: string[] = [],
    second: string[] = [];
  let lost = 0;
  const one = feeds.subscribe(new URLSearchParams('threads=1&thread=a&thread=a'), {
    send: (frame) => {
      first.push(frame);
      return true;
    },
    close: () => {
      lost++;
    },
  });
  const two = feeds.subscribe(new URLSearchParams('thread=a'), {
    send: (frame) => {
      second.push(frame);
      return true;
    },
    close: () => {
      lost++;
    },
  });
  try {
    await until(() => second.length === 1 && first.length === 2);
    expect(f.requests.length).toBe(1);
    expect(f.requests[0]?.getAll('thread')).toEqual(['a']);
    expect(
      first.some(
        (frame) =>
          frame.includes('metrics') || frame.includes('git-status') || frame.startsWith(':'),
      ),
    ).toBe(false);
    f.emit('thread:delta', { id: 'a', data: { turn: 'x', text: 'hello' } });
    f.emit('thread:delta', { id: 'other', data: { text: 'hidden' } });
    await until(() => second.length === 2);
    const third: string[] = [];
    const three = feeds.subscribe(new URLSearchParams('thread=a'), {
      send: (frame) => {
        third.push(frame);
        return true;
      },
      close: () => {
        lost++;
      },
    });
    expect(third.join('')).toEqual(second.join(''));
    await Bun.sleep(20);
    expect(f.requests.length).toBe(1);
    const reviews: string[] = [];
    const four = feeds.subscribe(new URLSearchParams('review=1&thread=b'), {
      send: (frame) => {
        reviews.push(frame);
        return true;
      },
      close: () => {
        lost++;
      },
    });
    await until(() => reviews.length === 2);
    expect(f.requests.length).toBe(2);
    expect(f.requests.at(-1)?.getAll('thread')).toEqual(['a', 'b']);
    expect(reviews.some((frame) => frame.includes('"id":"a"'))).toBe(false);
    f.lose();
    await until(() => lost === 4);
    four();
    three();
  } finally {
    one();
    two();
    await feeds.close();
    await f.server.stop(true);
  }
});
test('legacy upstream closes when the final optional subscriber leaves, including while connecting', async () => {
  const f = upstream(),
    feeds = new LegacyFeeds(f.server.url.origin, '/');
  try {
    const none = feeds.subscribe(new URLSearchParams(), { send: () => true, close: () => {} });
    none();
    await Bun.sleep(10);
    expect(f.requests.length).toBe(0);
    const stop = feeds.subscribe(new URLSearchParams('thread=a'), {
      send: () => true,
      close: () => {},
    });
    await until(() => f.open.size === 1);
    stop();
    await until(() => f.open.size === 0);
    const cancel = feeds.subscribe(new URLSearchParams('thread=b'), {
      send: () => true,
      close: () => {},
    });
    cancel();
    await feeds.close();
    expect(f.open.size).toBe(0);
  } finally {
    await feeds.close();
    await f.server.stop(true);
  }
});
test('native SSE bounds slow clients, cleans up aborts and never gzip-buffers event responses', async () => {
  let cleanup = 0;
  const abort = new AbortController();
  const response = eventResponse(abort.signal, async (sink) => {
    for (let i = 0; i < 1000; i++) if (!sink.send(eventFrame('thread:delta', { i }))) break;
    return () => {
      cleanup++;
    };
  });
  await Bun.sleep(0);
  expect(cleanup).toBe(1);
  const safe = await headers(
    response,
    new Request('http://localhost/api/stream', { headers: { 'Accept-Encoding': 'gzip' } }),
    true,
  );
  expect(safe.headers.get('content-encoding')).toBeNull();
  expect(safe.headers.get('cache-control')).toBe('no-cache, no-transform');
  expect((await safe.text()).split('event:').length).toBeLessThanOrEqual(66);
  let stop = 0;
  const active = eventResponse(abort.signal, async (sink) => {
    sink.send(': initial\n\n');
    return () => {
      stop++;
    };
  });
  await Bun.sleep(0);
  abort.abort();
  await active.text();
  expect(stop).toBe(1);
});

test('thread replay stops at 256 frames and obtains a fresh snapshot after overflow', async () => {
  const f = upstream(),
    feeds = new LegacyFeeds(f.server.url.origin, '/');
  const first: string[] = [],
    second: string[] = [];
  const sink = (frames: string[]) => ({
    send: (frame: string) => {
      frames.push(frame);
      return true;
    },
    close: () => {},
  });
  const one = feeds.subscribe(new URLSearchParams('thread=a'), sink(first));
  try {
    await until(() => first.length === 1);
    for (let i = 0; i < 255; i++) f.emit('thread:delta', { id: 'a', data: { i } });
    await until(() => first.length === 256);
    const two = feeds.subscribe(new URLSearchParams('thread=a'), sink(second));
    expect(second.length).toBe(1);
    expect(second.join('').split('event:').length - 1).toBe(256);
    const response = eventResponse(new AbortController().signal, async (sink) =>
      feeds.subscribe(new URLSearchParams('thread=a'), sink),
    );
    if (!response.body) throw new Error('missing replay body');
    const reader = response.body.getReader();
    const replay = await reader.read();
    expect(replay.done).toBe(false);
    expect(new TextDecoder().decode(replay.value).split('event:').length - 1).toBe(256);
    await reader.cancel();
    two();
    for (let i = 0; i < 50; i++) f.emit('thread:delta', { id: 'a', data: { i } });
    await until(() => first.length === 306);
    const fresh: string[] = [];
    const three = feeds.subscribe(new URLSearchParams('thread=a'), sink(fresh));
    await until(() => fresh.length === 1);
    expect(fresh[0]).toContain('event: thread:thread');
    expect(f.requests.length).toBe(2);
    expect(f.peak).toBe(1);
    three();
  } finally {
    one();
    await feeds.close();
    await f.server.stop(true);
  }
});

test('workspace streams own metrics and Git, ping after 15 seconds and cancel the shared feed', async () => {
  const f = upstream(),
    repo = await gitFixture();
  const index = new Index({
    root: repo.root,
    gitState: () => repo.status.read(repo.root),
    updated: async () => {},
  });
  await index.build();
  const git = new GitWorkspace(index, repo.commands);
  let metrics = 0;
  const streams = new WorkspaceStreams(git, f.server.url.origin, '/', async () => ({
    native: ++metrics,
  }));
  const abort = new AbortController();
  const response = streams.response(abort.signal, new URLSearchParams(), true);
  if (!response.body) throw new Error('missing SSE body');
  const reader = response.body.getReader(),
    frames: string[] = [];
  const consume = (async () => {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      frames.push(new TextDecoder().decode(part.value));
    }
  })();
  try {
    await until(() => frames.length === 2);
    expect(frames[0]).toContain('event: metrics\ndata: {"native":1}');
    expect(frames[1]).toContain('event: git-status');
    expect(f.requests.length).toBe(0);
    await Bun.sleep(15500);
    expect(frames.some((frame) => frame === ': ping\n\n')).toBe(true);
    expect(frames.some((frame) => frame === 'event: ping\ndata: {}\n\n')).toBe(true);
    expect(metrics).toBeGreaterThanOrEqual(6);
    const otherAbort = new AbortController();
    const other = streams.response(otherAbort.signal, new URLSearchParams('thread=a'), false);
    if (!other.body) throw new Error('missing Git SSE body');
    const otherReader = other.body.getReader();
    expect(new TextDecoder().decode((await otherReader.read()).value)).toContain(
      'event: git-status',
    );
    await until(() => f.open.size === 1);
    await otherReader.cancel();
    await until(() => f.open.size === 0);
  } finally {
    abort.abort();
    await consume;
    reader.releaseLock();
    await streams.close();
    await git.close();
    await repo.cleanup();
    await f.server.stop(true);
  }
}, 20000);
