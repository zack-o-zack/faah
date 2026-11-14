import { test, expect } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceWatch, gitEvent } from '../src/watch/service.ts';
test('watcher coalesces paths, filters nested ignores and git noise, retaining HEAD/index/refs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'faah-watch-')),
    batches: { paths: string[]; git: boolean }[] = [];
  const watcher = new WorkspaceWatch({
    root,
    delay: 10,
    changed: async (paths, git) => {
      batches.push({ paths, git });
    },
  });
  try {
    await mkdir(join(root, 'sub'));
    await writeFile(join(root, '.gitignore'), '*.tmp\n');
    await writeFile(join(root, 'sub/.gitignore'), 'secret.txt\n');
    const paths = [
      'a.go',
      'a.go',
      'x.tmp',
      'sub/secret.txt',
      '.git/objects/x',
      '.git/index',
      '.git/refs/heads/main',
    ];
    watcher.receive(paths.map((path) => ({ path: join(root, path), type: 'update' })));
    await Bun.sleep(30);
    await watcher.settled();
    expect(batches).toEqual([{ paths: ['a.go'], git: true }]);
    expect(gitEvent('.git/HEAD')).toBe(true);
    expect(gitEvent('.git/logs/HEAD')).toBe(false);
    await watcher.close();
    watcher.receive([{ path: join(root, 'ignored-after-close') }]);
    await Bun.sleep(20);
    expect(batches.length).toBe(1);
  } finally {
    await watcher.close();
    await rm(root, { recursive: true, force: true });
  }
}, 10000);
test('ignore changes clear nested filters and survive rules that ignore .gitignore itself', async () => {
  const root = await mkdtemp(join(tmpdir(), 'faah-watch-ignore-'));
  const batches: string[][] = [];
  const watcher = new WorkspaceWatch({
    root,
    delay: 1,
    changed: async (paths) => {
      batches.push(paths);
    },
  });
  try {
    await mkdir(join(root, 'sub'));
    await writeFile(join(root, '.gitignore'), '*.tmp\n.gitignore\n');
    watcher.receive([{ path: join(root, 'sub/a.tmp'), type: 'update' }]);
    await Bun.sleep(20);
    await watcher.settled();
    expect(batches).toEqual([]);
    await writeFile(join(root, '.gitignore'), '.gitignore\n');
    watcher.receive([
      { path: join(root, '.gitignore'), type: 'update' },
      { path: join(root, 'sub/a.tmp'), type: 'update' },
    ]);
    await Bun.sleep(20);
    await watcher.settled();
    expect(batches).toEqual([['.gitignore', 'sub/a.tmp']]);
  } finally {
    await watcher.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('native watcher observes an external edit and unsubscribes cleanly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'faah-native-watch-'));
  let done: () => void = () => {};
  const event = new Promise<void>((resolve) => {
    done = resolve;
  });
  const warnings: string[] = [];
  const watcher = new WorkspaceWatch({
    root,
    warn: (s) => warnings.push(s),
    changed: async (paths) => {
      if (paths.includes('proof.txt')) done();
    },
  });
  try {
    await watcher.start();
    expect(warnings).toEqual([]);
    await writeFile(join(root, 'proof.txt'), 'native');
    await Promise.race([
      event,
      Bun.sleep(5000).then(() => {
        throw new Error('native watcher timeout');
      }),
    ]);
  } finally {
    await watcher.close();
    await rm(root, { recursive: true, force: true });
  }
}, 10000);

test('watcher subscription failures warn and leave a usable no-watcher fallback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'faah-watch-fail-')),
    warnings: string[] = [];
  const watcher = new WorkspaceWatch({
    root,
    connect: async () => {
      throw new Error('too many open files');
    },
    changed: async () => {},
    warn: (s) => warnings.push(s),
  });
  try {
    await watcher.start();
    expect(warnings).toEqual(['faah watcher disabled: Error: too many open files']);
  } finally {
    await watcher.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('linked worktree watchers observe the external git directory', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'faah-watch-worktree-')),
    root = join(temp, 'repo'),
    git = join(temp, 'meta');
  await mkdir(root);
  await mkdir(git);
  await writeFile(join(root, '.git'), 'gitdir: ' + git + '\n');
  let done: () => void = () => {};
  const event = new Promise<void>((resolve) => {
    done = resolve;
  });
  const watcher = new WorkspaceWatch({
    root,
    changed: async (_, git) => {
      if (git) done();
    },
  });
  try {
    await watcher.start();
    await writeFile(join(git, 'HEAD'), 'ref: refs/heads/main\n');
    await Promise.race([
      event,
      Bun.sleep(5000).then(() => {
        throw new Error('git metadata watcher timeout');
      }),
    ]);
  } finally {
    await watcher.close();
    await rm(temp, { recursive: true, force: true });
  }
}, 10000);
