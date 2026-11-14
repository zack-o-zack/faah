import { test, expect } from 'bun:test';
import { WatcherProcess } from '../src/watch/process.ts';
import { WorkspaceWatch } from '../src/watch/service.ts';
import type { WatchEvent } from '../src/watch/service.ts';
import { request, reply } from '../src/watch/protocol.ts';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function helper(mode: string, timeout = 500) {
  return new WatcherProcess(
    [process.execPath, new URL('./watch-helper-fixture.ts', import.meta.url).pathname, mode],
    timeout,
  );
}
function reaped(pid: number | undefined) {
  if (!pid) throw new Error('helper never started');
  expect(() => process.kill(pid, 0)).toThrow();
}
async function started(watcher: WatcherProcess): Promise<number | undefined> {
  const deadline = performance.now() + 1000;
  while (!watcher.pid && performance.now() < deadline) await Bun.sleep(1);
  return watcher.pid;
}
test('watcher helper shares one process across roots, forwards typed events and reaps on last unsubscribe', async () => {
  const watcher = helper('healthy'),
    events: WatchEvent[] = [];
  try {
    const first = await watcher.subscribe('one', (error, batch) => {
      expect(error).toBeNull();
      events.push(...batch);
    });
    const pid = watcher.pid;
    const second = await watcher.subscribe('two', (error, batch) => {
      expect(error).toBeNull();
      events.push(...batch);
    });
    expect(watcher.pid).toBe(pid);
    await Bun.sleep(10);
    expect(events.map((e) => e.path)).toEqual(['one/proof.txt', 'two/proof.txt']);
    await first();
    expect(watcher.pid).toBe(pid);
    await second();
    await watcher.close();
    reaped(pid);
  } finally {
    await watcher.close();
  }
});
test('blocked native startup cannot stall HTTP and activates no-watcher fallback within its deadline', async () => {
  const child = helper('stall', 200),
    warnings: string[] = [],
    available: boolean[] = [];
  const watcher = new WorkspaceWatch({
    root: import.meta.dir,
    connect: child.subscribe.bind(child),
    changed: async () => {},
    warn: (message) => warnings.push(message),
    availability: (value) => available.push(value),
  });
  const server = Bun.serve({ port: 0, fetch: () => Response.json({ ready: true }) });
  const starting = watcher.start();
  const pid = await started(child);
  try {
    const response = await fetch(server.url, { signal: AbortSignal.timeout(1000) });
    expect(await response.json()).toEqual({ ready: true });
    await starting;
    expect(available).toEqual([false]);
    expect(warnings).toEqual(['faah watcher disabled: Error: watcher subscribe timed out']);
  } finally {
    await watcher.close();
    await child.close();
    await server.stop(true);
  }
  reaped(pid);
});
test('shutdown cancels a blocked startup promptly and reaps the helper', async () => {
  const watcher = helper('stall', 10000);
  const pending = watcher.subscribe('root', () => {});
  const rejected = pending.then(
    () => 'unexpected success',
    (error: unknown) => String(error),
  );
  const pid = watcher.pid;
  await watcher.close();
  expect(await rejected).toBe('Error: watcher closed');
  reaped(pid);
});
test('helper exit, malformed output and explicit errors reject startup and reap the process', async () => {
  for (const mode of ['exit', 'bad', 'error']) {
    const watcher = helper(mode);
    const pending = watcher.subscribe('root', () => {}),
      pid = watcher.pid;
    await expect(pending).rejects.toThrow();
    await watcher.close();
    reaped(pid);
  }
});
test('blocked unsubscribe and later-root startup close active subscriptions and remain cancellable', async () => {
  for (const mode of ['healthy', 'unsub-stall']) {
    const watcher = helper(mode, 500);
    const errors: string[] = [];
    const stop = await watcher.subscribe('root', (error) => {
      if (error) errors.push(error.message);
    });
    const pid = watcher.pid;
    if (mode === 'healthy') {
      await expect(watcher.subscribe('blocked', () => {})).rejects.toThrow('timed out');
      expect(errors).toEqual(['watcher subscribe timed out']);
      await stop();
    } else await expect(stop()).rejects.toThrow('timed out');
    await watcher.close();
    reaped(pid);
  }
});
test('watcher protocol rejects invalid external input', () => {
  expect(() => request('{"id":1,"type":"wrong"}')).toThrow();
  expect(() => reply('{"id":"one"}')).toThrow();
  expect(() => reply('{"id":1,"events":[{"path":3}]}')).toThrow();
  expect(() => reply('{"id":1,"events":[{"path":"a","type":"wrong"}]}')).toThrow();
});

test('real native helper delivers filesystem events and exits after its last subscription', async () => {
  const root = await mkdtemp(join(tmpdir(), 'faah-watch-helper-'));
  const watcher = new WatcherProcess();
  let observed: () => void = () => {};
  const event = new Promise<void>((resolve) => {
    observed = resolve;
  });
  try {
    const stop = await watcher.subscribe(root, (error, events) => {
      if (error) throw error;
      if (events.some((event) => event.path.endsWith('/proof.txt'))) observed();
    });
    const pid = watcher.pid;
    await writeFile(join(root, 'proof.txt'), 'event\n');
    await Promise.race([
      event,
      Bun.sleep(3000).then(() => {
        throw new Error('helper event timeout');
      }),
    ]);
    await stop();
    await watcher.close();
    reaped(pid);
  } finally {
    await watcher.close();
    await rm(root, { recursive: true, force: true });
  }
});
