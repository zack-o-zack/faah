import { test, expect, spyOn } from 'bun:test';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { gitFixture } from './git-fixture.ts';
import { Index } from '../src/index/service.ts';
import { GitWorkspace, type GitPayload } from '../src/git/workspace.ts';
import { GitActions } from '../src/git/actions.ts';
import { gitActionRoutes } from '../src/git/routes.ts';
import { RouteTable, runRoute } from '../src/http/routes.ts';
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
  const repo = await gitFixture();
  await repo.write('a.txt', 'old\n');
  await repo.run('add', '.');
  await repo.run('commit', '-qm', 'Initial');
  const index = new Index({
    root: repo.root,
    gitState: () => repo.status.read(repo.root),
    updated: async () => {},
  });
  await index.build();
  const git = new GitWorkspace(index, repo.commands);
  return {
    f: repo,
    index,
    git,
    close: async () => {
      await git.close();
      await repo.cleanup();
    },
  };
}

test('native Git refresh is lazy without subscribers and suppresses unchanged snapshots', async () => {
  const context = await setup();
  try {
    const initial = await context.git.refresh();
    expect(initial.gitFiles).toEqual([]);
    expect(initial.statuses).toEqual({});
    await context.f.write('sub/new.txt', 'new\n');
    await context.git.changed();
    expect(context.index.git.statuses).toEqual({});
    expect((await context.git.ensure()).dirtyDirs).toEqual({ sub: true });
    const events: GitPayload[] = [];
    const stop = await context.git.subscribe((payload) => events.push(payload));
    expect(events.length).toBe(1);
    await context.git.refresh();
    expect(events.length).toBe(1);
    await context.f.run('add', '.');
    await context.git.changed(true);
    expect(events.at(-1)?.staged).toEqual({ 'sub/new.txt': true });
    await context.f.write('sub/new.txt', 'again\n');
    await context.git.changed();
    expect(events.at(-1)?.partial).toEqual({ 'sub/new.txt': true });
    stop();
  } finally {
    await context.close();
  }
});
test('filesystem events update native status, branch and index overlays without legacy Git', async () => {
  const context = await setup();
  const watch = new WorkspaceWatch({
    root: context.f.root,
    delay: 1,
    changed: async (paths, metadata) => {
      for (const path of paths) await context.index.touch(path);
      await context.git.changed(metadata);
    },
  });
  try {
    const events: GitPayload[] = [];
    const stop = await context.git.subscribe((payload) => events.push(payload));
    await context.f.write('a.txt', 'modified\n');
    watch.receive([{ path: join(context.f.root, 'a.txt'), type: 'update' }]);
    await Bun.sleep(20);
    await watch.settled();
    expect(events.at(-1)?.statuses).toEqual({ 'a.txt': 'M' });
    expect((await context.index.list(''))?.[0]?.status).toBe('M');
    await context.f.run('checkout', '-qb', 'other');
    watch.receive([{ path: join(context.f.root, '.git/HEAD'), type: 'update' }]);
    await Bun.sleep(20);
    await watch.settled();
    expect(events.at(-1)?.branch).toBe('other');
    stop();
  } finally {
    await watch.close();
    await context.close();
  }
});
test('native Git mutation routes preserve guards, ordered JSON, staging, hunk errors and sync state', async () => {
  const context = await setup();
  const actions = new GitActions(context.git, async () => {});
  const table = new RouteTable([gitActionRoutes(actions)]);
  const route = async (name: string, body: string, method = 'POST') => {
    const request = new Request('http://localhost/api/git/' + name, {
      method,
      headers: { host: 'localhost', origin: 'http://localhost' },
      ...(method === 'GET' ? {} : { body }),
    });
    const url = new URL(request.url);
    const def = table.find('api/git/' + name);
    if (!def) throw new Error('missing native Git route');
    const response = await runRoute(def, {
      request,
      url,
      query: url.searchParams,
      route: 'api/git/' + name,
    });
    const value: unknown = await response.json();
    return { status: response.status, value };
  };
  try {
    expect((await route('stage', '', 'GET')).status).toBe(405);
    expect(await route('stage', '{"path":3}')).toEqual({
      status: 400,
      value: { error: 'path is required' },
    });
    expect((await route('stage', '{"path":"../outside"}')).status).toBe(400);
    await context.f.write('a.txt', 'modified\n');
    expect((await route('stage', '{"Path":"missing","path":"a.txt"} trailing')).status).toBe(200);
    expect(context.index.git.staged).toEqual({ 'a.txt': true });
    expect((await route('unstage', '{"path":"a.txt"}')).status).toBe(200);
    expect(context.index.git.staged).toEqual({});
    expect(await route('hunk', '{"path":"a.txt","hunk":"bad","action":"stage"}')).toEqual({
      status: 502,
      value: { error: 'hunk must start with @@ header' },
    });
    expect(await route('commit', '{"message":"  "}')).toEqual({
      status: 400,
      value: { error: 'message is required' },
    });
    expect((await route('commit', '{"message":"  Committed  "}')).status).toBe(200);
    expect(await context.f.run('log', '-1', '--format=%s')).toBe('Committed');
    expect((await route('sync-state', '', 'GET')).value).toEqual({
      branch: 'main',
      upstream: '',
      ahead: 0,
      behind: 0,
      dirty: false,
    });
    expect((await route('pull', '{}')).status).toBe(400);
  } finally {
    await context.close();
  }
});
test('Git-disabled and not-ready payloads preserve null maps and empty subscription snapshots', async () => {
  const context = await setup();
  try {
    context.index.ready = false;
    context.index.git = emptyGit();
    const payload = await context.git.refresh();
    expect(payload.git).toBe(true);
    expect(payload.gitFiles).toBeNull();
    expect(payload.statuses).toBeNull();
    for (const path of [
      '',
      'FETCH_HEAD',
      'MERGE_HEAD',
      'rebase-merge',
      'rebase-merge/head-name',
      'rebase-apply/applying',
      'refs/heads/main',
    ])
      expect(gitEvent(path ? '.git/' + path : '.git')).toBe(true);
    expect(gitEvent('.git/objects/aa/bb')).toBe(false);
  } finally {
    await context.close();
  }
});

test('ignored filesystem paths still invalidate Git because tracked files can match ignore rules', async () => {
  const context = await setup();
  const watch = new WorkspaceWatch({
    root: context.f.root,
    delay: 1,
    ignored: () => context.git.changed(),
    changed: async (paths, metadata) => {
      for (const path of paths) await context.index.touch(path);
      await context.git.changed(metadata);
    },
  });
  try {
    await context.f.write('.gitignore', 'a.txt\n');
    await context.f.run('add', '.gitignore');
    await context.f.run('commit', '-qm', 'Ignore tracked name');
    await context.index.build();
    const events: GitPayload[] = [];
    const stop = await context.git.subscribe((payload) => events.push(payload));
    await context.f.write('a.txt', 'tracked but ignored\n');
    watch.receive([{ path: join(context.f.root, 'a.txt'), type: 'update' }]);
    await Bun.sleep(20);
    await watch.settled();
    expect(events.at(-1)?.statuses?.['a.txt']).toBe('M');
    stop();
  } finally {
    await watch.close();
    await context.close();
  }
});

test('native watcher detects CLI commits, new edits and deletes, then removes committed deletion overlays', async () => {
  const context = await setup();
  const watch = new WorkspaceWatch({
    root: context.f.root,
    gitDirectory: async () => (await context.f.commands.probe.get(context.f.root))?.dir,
    availability: (available) => {
      context.git.watching(available);
    },
    changed: async (paths, metadata) => {
      for (const path of paths) await context.index.touch(path);
      await context.git.changed(metadata);
    },
  });
  try {
    await context.f.write('sub/inner/deleted.txt', 'deleted\n');
    await context.f.run('add', '.');
    await context.f.run('commit', '-qm', 'Nested');
    await context.index.build();
    const events: GitPayload[] = [];
    const stop = await context.git.subscribe((payload) => events.push(payload));
    await watch.start();
    await context.f.write('a.txt', 'cli commit\n');
    await context.f.run('commit', '-qam', 'From CLI');
    await until(() => events.at(-1)?.recentCommits?.[0]?.subject === 'From CLI');
    expect(events.at(-1)?.statuses).toEqual({});
    await context.f.write('brand_new.txt', 'new\n');
    await context.f.write('a.txt', 'after commit\n');
    await until(() => events.at(-1)?.gitChanges === 2);
    expect((await context.index.list(''))?.find((n) => n.path === 'brand_new.txt')?.status).toBe(
      'U',
    );
    await rm(join(context.f.root, 'sub'), { recursive: true });
    await until(() => events.at(-1)?.statuses?.['sub/inner/deleted.txt'] === 'D');
    expect((await context.index.list('sub/inner'))?.[0]?.status).toBe('D');
    expect((await context.index.list(''))?.find((n) => n.path === 'sub')?.dirty).toBe(true);
    await context.f.run('add', '-A');
    await context.f.run('commit', '-qm', 'Remove nested');
    await until(() => events.at(-1)?.recentCommits?.[0]?.subject === 'Remove nested');
    expect(await context.index.list('sub/inner')).toBeUndefined();
    expect((await context.index.list(''))?.some((n) => n.path === 'sub')).toBe(false);
    stop();
  } finally {
    await watch.close();
    await context.close();
  }
}, 15000);

test('unavailable watcher polls active subscribers and refreshes on demand without subscribers', async () => {
  const context = await setup();
  try {
    context.git.watching(false);
    await context.git.ensure();
    await context.f.write('a.txt', 'no subscriber\n');
    expect((await context.git.ensure()).statuses).toEqual({ 'a.txt': 'M' });
    const events: GitPayload[] = [];
    const stop = await context.git.subscribe((payload) => events.push(payload));
    await context.f.run('add', '.');
    await context.f.run('commit', '-qm', 'Polled');
    await until(() => events.at(-1)?.recentCommits?.[0]?.subject === 'Polled');
    expect(events.at(-1)?.statuses).toEqual({});
    stop();
    const count = events.length;
    await context.f.write('a.txt', 'unobserved\n');
    await Bun.sleep(1100);
    expect(events.length).toBe(count);
    expect((await context.git.ensure()).statuses).toEqual({ 'a.txt': 'M' });
  } finally {
    await context.close();
  }
}, 10000);

test('fallback stream readers reuse snapshots and explicit refresh still observes edits', async () => {
  const context = await setup();
  const runs = spyOn(context.f.processes, 'run');
  try {
    context.git.watching(false);
    const stop = await context.git.subscribe(() => undefined);
    runs.mockClear();
    await Promise.all(Array.from({ length: 30 }, () => context.git.ensure()));
    expect(runs).not.toHaveBeenCalled();
    await context.f.write('a.txt', 'explicit refresh\n');
    expect((await context.git.refresh()).statuses).toEqual({ 'a.txt': 'M' });
    expect(runs).toHaveBeenCalled();
    stop();
  } finally {
    runs.mockRestore();
    await context.close();
  }
});

test('subscription before index readiness publishes ready status and rebuild invalidation stays authoritative', async () => {
  const context = await setup();
  try {
    context.index.ready = false;
    const events: GitPayload[] = [];
    const stop = await context.git.subscribe((payload) => events.push(payload));
    expect(events[0]?.statuses).toBeNull();
    await context.f.write('new.txt', 'new\n');
    await context.index.build();
    await context.git.changed(true);
    expect(events.at(-1)?.statuses).toEqual({ 'new.txt': 'U' });
    await context.f.run('add', '.');
    await context.f.run('commit', '-qm', 'Rebuilt');
    await context.index.build();
    context.git.invalidate(true);
    expect((await context.git.ensure()).recentCommits?.[0]?.subject).toBe('Rebuilt');
    expect(context.index.git.statuses).toEqual({});
    stop();
  } finally {
    await context.close();
  }
});
