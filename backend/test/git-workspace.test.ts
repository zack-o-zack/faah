import { test, expect } from 'bun:test';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { gitFixture } from './git-fixture.ts';
import { Index } from '../src/index/service.ts';
import { GitWorkspace, type GitPayload } from '../src/git/workspace.ts';
import { GitActions } from '../src/git/actions.ts';
import { gitActionRoute } from '../src/git/action-routes.ts';
import { WorkspaceWatch, gitEvent } from '../src/watch/service.ts';
import { emptyGit } from '../src/index/types.ts';
async function until(check: () => boolean) {
  const deadline = performance.now() + 5000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error('Git update timed out');
    await Bun.sleep(10);
  }
}
async function setup() {
  const f = await gitFixture();
  await f.write('a.txt', 'old\n');
  await f.run('add', '.');
  await f.run('commit', '-qm', 'Initial');
  const index = new Index({
    root: f.root,
    gitState: () => f.status.read(f.root),
    updated: async () => {},
  });
  await index.build();
  const git = new GitWorkspace(index, f.commands);
  return {
    f,
    index,
    git,
    close: async () => {
      await git.close();
      await f.cleanup();
    },
  };
}
test('native Git refresh is lazy without subscribers and suppresses unchanged snapshots', async () => {
  const t = await setup();
  try {
    const initial = await t.git.refresh();
    expect(initial.gitFiles).toEqual([]);
    expect(initial.statuses).toEqual({});
    await t.f.write('sub/new.txt', 'new\n');
    await t.git.changed();
    expect(t.index.git.statuses).toEqual({});
    expect((await t.git.ensure()).dirtyDirs).toEqual({ sub: true });
    const events: GitPayload[] = [];
    const stop = await t.git.subscribe((payload) => events.push(payload));
    expect(events.length).toBe(1);
    await t.git.refresh();
    expect(events.length).toBe(1);
    await t.f.run('add', '.');
    await t.git.changed(true);
    expect(events.at(-1)?.staged).toEqual({ 'sub/new.txt': true });
    await t.f.write('sub/new.txt', 'again\n');
    await t.git.changed();
    expect(events.at(-1)?.partial).toEqual({ 'sub/new.txt': true });
    stop();
  } finally {
    await t.close();
  }
});
test('filesystem events update native status, branch and index overlays without legacy Git', async () => {
  const t = await setup();
  const watch = new WorkspaceWatch({
    root: t.f.root,
    delay: 1,
    changed: async (paths, metadata) => {
      for (const path of paths) await t.index.touch(path);
      await t.git.changed(metadata);
    },
  });
  try {
    const events: GitPayload[] = [];
    const stop = await t.git.subscribe((payload) => events.push(payload));
    await t.f.write('a.txt', 'modified\n');
    watch.receive([{ path: join(t.f.root, 'a.txt'), type: 'update' }]);
    await Bun.sleep(20);
    await watch.settled();
    expect(events.at(-1)?.statuses).toEqual({ 'a.txt': 'M' });
    expect((await t.index.list(''))?.[0]?.status).toBe('M');
    await t.f.run('checkout', '-qb', 'other');
    watch.receive([{ path: join(t.f.root, '.git/HEAD'), type: 'update' }]);
    await Bun.sleep(20);
    await watch.settled();
    expect(events.at(-1)?.branch).toBe('other');
    stop();
  } finally {
    await watch.close();
    await t.close();
  }
});
test('native Git mutation routes preserve guards, ordered JSON, staging, hunk errors and sync state', async () => {
  const t = await setup();
  const actions = new GitActions(t.git, async () => {});
  const route = async (name: string, body: string, method = 'POST') => {
    const response = await gitActionRoute(
      actions,
      new Request('http://localhost/api/git/' + name, {
        method,
        headers: { host: 'localhost', origin: 'http://localhost' },
        ...(method === 'GET' ? {} : { body }),
      }),
      'api/git/' + name,
    );
    if (!response) throw new Error('missing native Git route');
    return { status: response.status, value: await response.json() };
  };
  try {
    expect((await route('stage', '', 'GET')).status).toBe(405);
    expect(await route('stage', '{"path":3}')).toEqual({
      status: 400,
      value: { error: 'path is required' },
    });
    expect((await route('stage', '{"path":"../outside"}')).status).toBe(400);
    await t.f.write('a.txt', 'modified\n');
    expect((await route('stage', '{"Path":"missing","path":"a.txt"} trailing')).status).toBe(200);
    expect(t.index.git.staged).toEqual({ 'a.txt': true });
    expect((await route('unstage', '{"path":"a.txt"}')).status).toBe(200);
    expect(t.index.git.staged).toEqual({});
    expect(await route('hunk', '{"path":"a.txt","hunk":"bad","action":"stage"}')).toEqual({
      status: 502,
      value: { error: 'hunk must start with @@ header' },
    });
    expect(await route('commit', '{"message":"  "}')).toEqual({
      status: 400,
      value: { error: 'message is required' },
    });
    expect((await route('commit', '{"message":"  Committed  "}')).status).toBe(200);
    expect(await t.f.run('log', '-1', '--format=%s')).toBe('Committed');
    expect((await route('sync-state', '', 'GET')).value).toEqual({
      branch: 'main',
      upstream: '',
      ahead: 0,
      behind: 0,
      dirty: false,
    });
    expect((await route('pull', '{}')).status).toBe(400);
  } finally {
    await t.close();
  }
});
test('Git-disabled and not-ready payloads preserve null maps and empty subscription snapshots', async () => {
  const t = await setup();
  try {
    t.index.ready = false;
    t.index.git = emptyGit();
    const payload = await t.git.refresh();
    expect(payload.git).toBe(true);
    expect(payload.gitFiles).toBeNull();
    expect(payload.statuses).toBeNull();
    for (const path of [
      'FETCH_HEAD',
      'MERGE_HEAD',
      'rebase-merge',
      'rebase-merge/head-name',
      'rebase-apply/applying',
      'refs/heads/main',
    ])
      expect(gitEvent('.git/' + path)).toBe(true);
    expect(gitEvent('.git/objects/aa/bb')).toBe(false);
  } finally {
    await t.close();
  }
});

test('native watcher detects CLI commits, new edits and deletes, then removes committed deletion overlays', async () => {
  const t = await setup();
  const watch = new WorkspaceWatch({
    root: t.f.root,
    gitDirectory: async () => (await t.f.commands.probe.get(t.f.root))?.dir,
    availability: (available) => t.git.watching(available),
    changed: async (paths, metadata) => {
      for (const path of paths) await t.index.touch(path);
      await t.git.changed(metadata);
    },
  });
  try {
    await t.f.write('sub/inner/deleted.txt', 'deleted\n');
    await t.f.run('add', '.');
    await t.f.run('commit', '-qm', 'Nested');
    await t.index.build();
    const events: GitPayload[] = [];
    const stop = await t.git.subscribe((payload) => events.push(payload));
    await watch.start();
    await t.f.write('a.txt', 'cli commit\n');
    await t.f.run('commit', '-qam', 'From CLI');
    await until(() => events.at(-1)?.recentCommits?.[0]?.subject === 'From CLI');
    expect(events.at(-1)?.statuses).toEqual({});
    await t.f.write('brand_new.txt', 'new\n');
    await t.f.write('a.txt', 'after commit\n');
    await until(() => events.at(-1)?.gitChanges === 2);
    expect((await t.index.list(''))?.find((n) => n.path === 'brand_new.txt')?.status).toBe('U');
    await rm(join(t.f.root, 'sub'), { recursive: true });
    await until(() => events.at(-1)?.statuses?.['sub/inner/deleted.txt'] === 'D');
    expect((await t.index.list('sub/inner'))?.[0]?.status).toBe('D');
    expect((await t.index.list(''))?.find((n) => n.path === 'sub')?.dirty).toBe(true);
    await t.f.run('add', '-A');
    await t.f.run('commit', '-qm', 'Remove nested');
    await until(() => events.at(-1)?.recentCommits?.[0]?.subject === 'Remove nested');
    expect(await t.index.list('sub/inner')).toBeUndefined();
    expect((await t.index.list(''))?.some((n) => n.path === 'sub')).toBe(false);
    stop();
  } finally {
    await watch.close();
    await t.close();
  }
}, 15000);

test('unavailable watcher polls active subscribers and refreshes on demand without subscribers', async () => {
  const t = await setup();
  try {
    t.git.watching(false);
    await t.git.ensure();
    await t.f.write('a.txt', 'no subscriber\n');
    expect((await t.git.ensure()).statuses).toEqual({ 'a.txt': 'M' });
    const events: GitPayload[] = [];
    const stop = await t.git.subscribe((payload) => events.push(payload));
    await t.f.run('add', '.');
    await t.f.run('commit', '-qm', 'Polled');
    await until(() => events.at(-1)?.recentCommits?.[0]?.subject === 'Polled');
    expect(events.at(-1)?.statuses).toEqual({});
    stop();
    const count = events.length;
    await t.f.write('a.txt', 'unobserved\n');
    await Bun.sleep(1100);
    expect(events.length).toBe(count);
    expect((await t.git.ensure()).statuses).toEqual({ 'a.txt': 'M' });
  } finally {
    await t.close();
  }
}, 10000);

test('subscription before index readiness publishes ready status and rebuild invalidation stays authoritative', async () => {
  const t = await setup();
  try {
    t.index.ready = false;
    const events: GitPayload[] = [];
    const stop = await t.git.subscribe((payload) => events.push(payload));
    expect(events[0]?.statuses).toBeNull();
    await t.f.write('new.txt', 'new\n');
    await t.index.build();
    await t.git.changed(true);
    expect(events.at(-1)?.statuses).toEqual({ 'new.txt': 'U' });
    await t.f.run('add', '.');
    await t.f.run('commit', '-qm', 'Rebuilt');
    await t.index.build();
    t.git.invalidate(true);
    expect((await t.git.ensure()).recentCommits?.[0]?.subject).toBe('Rebuilt');
    expect(t.index.git.statuses).toEqual({});
    stop();
  } finally {
    await t.close();
  }
});
