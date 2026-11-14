import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { Index } from '../src/index/service.ts';
import { Search } from '../src/search/service.ts';
import { sortNodes } from '../src/index/walk.ts';
import { emptyGit, type GitState } from '../src/index/types.ts';

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'faah-index-'));
  const index = new Index({ root, gitState: async () => emptyGit(), updated: async () => {} });

  async function write(path: string, text = 'x') {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }

  return { root, index, write, close: () => rm(root, { recursive: true, force: true }) };
}

test('Go index ignores hierarchically, publishes root early and lists ignored folders on demand', async () => {
  const tree = await workspace();
  try {
    await tree.write('.gitignore', 'secret/\n*.tmp\n!keep.tmp\n');
    await tree.write('main.go');
    await tree.write('secret/keys.go');
    await tree.write('secret/sub/nested.go');
    await tree.write('root.tmp');
    await tree.write('keep.tmp');
    await tree.write('sub/.gitignore', 'local.txt\n!keep.tmp\n');
    await tree.write('sub/local.txt');
    await tree.write('sub/keep.tmp');
    await tree.write('sub/deep/local.txt');
    await tree.write('.git/HEAD');
    await tree.write('.hg/store');
    await tree.write('.svn/entries');
    await symlink(join(tree.root, 'main.go'), join(tree.root, 'link.go'));
    let release = () => {};
    const git = new Promise<GitState>((resolve) => {
      release = () => {
        resolve(emptyGit());
      };
    });
    const index = new Index({ root: tree.root, gitState: () => git, updated: async () => {} });
    const build = index.build();
    while (!index.children.has('')) await Bun.sleep(1);
    expect(index.ready).toBe(false);
    expect(index.files).toEqual([]);
    expect((await index.list(''))?.some((n) => n.name === 'secret' && n.ignored)).toBe(true);
    release();
    await build;
    expect(index.ready).toBe(true);
    expect(index.files.map((file) => file.path)).toEqual([
      '.gitignore',
      'keep.tmp',
      'main.go',
      'sub/.gitignore',
      'sub/deep/local.txt',
      'sub/keep.tmp',
    ]);
    expect((await index.list('secret'))?.every((n) => n.ignored && n.size === 0)).toBe(true);
    expect((await index.list('secret/sub'))?.map((n) => n.path)).toEqual(['secret/sub/nested.go']);
    expect(index.children.has('secret')).toBe(false);
    for (const bad of [
      'secret/..',
      'secret/../..',
      'secret/../../etc',
      'secret//keys.go',
      'secret/./sub',
      'secret\\sub',
      '.git',
    ])
      expect(await index.list(bad)).toBeUndefined();
  } finally {
    await tree.close();
  }
});

test('Go compact all, changed and yours views retain the deepest directory flags', async () => {
  const tree = await workspace();
  try {
    for (const path of ['one/two/three/abcd.ts', 'docs/a.md', 'docs/guide/b.md', 'top.txt'])
      await tree.write(path);
    await tree.index.build();
    expect((await tree.index.compact('', 'all'))?.map((n) => [n.name, n.path])).toEqual([
      ['docs', 'docs'],
      ['one/two/three', 'one/two/three'],
      ['top.txt', 'top.txt'],
    ]);
    await tree.index.applyGit({
      ...emptyGit(),
      git: true,
      statuses: { 'docs/guide/b.md': 'M', 'one/two/three/abcd.ts': 'U' },
      yourStatuses: { 'docs/guide/b.md': 'A' },
    });
    expect(
      (await tree.index.compact('', 'changed'))?.find((n) => n.path === 'docs/guide'),
    ).toMatchObject({ name: 'docs/guide', dirty: true, yourDirty: true });
    expect(
      (await tree.index.compact('', 'yours'))?.find((n) => n.path === 'docs/guide')?.name,
    ).toBe('docs/guide');
    expect((await tree.index.compact('', ''))?.find((n) => n.name === 'docs')?.path).toBe('docs');
    expect((await tree.index.list(''))?.find((n) => n.name === 'docs')?.path).toBe('docs');
  } finally {
    await tree.close();
  }
});

test('Go TouchPath inserts, updates and evicts paths without descending into ignored folders', async () => {
  const tree = await workspace();
  try {
    await tree.write('existing.go', 'package main\n');
    await tree.write('.gitignore', 'ignored/\n*.tmp\n');
    await tree.index.build();
    await tree.write('sub/added.go', 'package sub\n');
    await tree.index.touch('sub/added.go');
    expect((await tree.index.list('sub'))?.map((n) => n.path)).toEqual(['sub/added.go']);
    expect(tree.index.files.find((n) => n.path === 'sub/added.go')?.size).toBe(12);
    await tree.write('sub/added.go', 'longer content\n');
    await tree.index.touch('sub/added.go');
    expect(tree.index.files.find((n) => n.path === 'sub/added.go')?.size).toBe(15);
    await tree.write('ignored/no.go');
    await tree.index.touch('ignored/no.go');
    expect(tree.index.children.has('ignored')).toBe(false);
    await tree.write('skip.tmp');
    await tree.index.touch('skip.tmp');
    expect((await tree.index.list(''))?.find((n) => n.name === 'skip.tmp')?.ignored).toBe(true);
    expect(tree.index.files.some((n) => n.path === 'skip.tmp')).toBe(false);
    await rm(join(tree.root, 'sub/added.go'));
    await tree.index.touch('sub/added.go');
    expect(await tree.index.list('sub')).toEqual([]);
    expect(tree.index.files.some((n) => n.path === 'sub/added.go')).toBe(false);
    await tree.index.touch('../escape');
    await tree.index.touch('');
    await mkdir(join(tree.root, 'empty'));
    await tree.index.touch('empty');
    expect(await tree.index.list('empty')).toEqual([]);
  } finally {
    await tree.close();
  }
});

test('touching walked files preserves parallel search while file and parent symlinks fall back', async () => {
  const tree = await workspace();
  const strategies: string[] = [];
  const search = new Search({
    root: tree.root,
    files: () => tree.index.files,
    strategy: 'walk',
    profile: (entry) => strategies.push(entry.strategy),
  });
  const query = () => search.search({ query: 'needle' }, AbortSignal.timeout(10000));
  try {
    await tree.write('direct.txt', 'needle');
    await tree.write('parent/file.txt', 'needle');
    await tree.write('other/file.txt', 'needle');
    await tree.index.build();
    await tree.write('direct.txt', 'needle edited');
    await tree.index.touch('direct.txt');
    expect(tree.index.files.find((n) => n.path === 'direct.txt')?.walked).toBe(true);
    await query();
    expect(strategies.at(-1)).toBe('walk');
    await rm(join(tree.root, 'direct.txt'));
    await symlink(join(tree.root, 'other/file.txt'), join(tree.root, 'direct.txt'));
    await tree.index.touch('direct.txt');
    expect((await query()).results.some((n) => n.path === 'direct.txt')).toBe(true);
    expect(strategies.at(-1)).toBe('explicit');
    await tree.index.build();
    await rm(join(tree.root, 'parent'), { recursive: true });
    await symlink(join(tree.root, 'other'), join(tree.root, 'parent'));
    await tree.index.touch('parent/file.txt');
    expect((await query()).results.some((n) => n.path === 'parent/file.txt')).toBe(true);
    expect(strategies.at(-1)).toBe('explicit');
  } finally {
    await tree.close();
  }
});

test('Go Git overlays inject deleted files, track staged/partial and clean committed deletions', async () => {
  const tree = await workspace();
  try {
    await tree.write('present.go');
    await tree.index.build();
    const state: GitState = {
      git: true,
      statuses: { 'gone/deep/file.go': 'D', 'present.go': 'M', 'new.txt': 'U' },
      staged: { 'present.go': true },
      partial: { 'present.go': true },
      yourStatuses: { 'gone/deep/file.go': 'D' },
    };
    await tree.index.applyGit(state);
    expect(tree.index.gitFiles).toEqual(['gone/deep/file.go', 'present.go', 'new.txt']);
    expect((await tree.index.list('gone/deep'))?.[0]).toMatchObject({
      status: 'D',
      yourStatus: 'D',
      size: 0,
    });
    expect((await tree.index.list(''))?.find((n) => n.path === 'present.go')).toMatchObject({
      status: 'M',
      staged: true,
      partial: true,
    });
    await tree.index.applyGit(emptyGit());
    expect(await tree.index.list('gone')).toBeUndefined();
    expect((await tree.index.list(''))?.find((n) => n.path === 'present.go')).toEqual({
      name: 'present.go',
      path: 'present.go',
      dir: false,
      size: 1,
    });
  } finally {
    await tree.close();
  }
});

test('sortNodes puts directories first and compares folded UTF-8 names', () => {
  const names = ['z', 'Ä', 'a', '你', 'B'];
  const sorted = sortNodes(names.map((name, i) => ({ name, path: name, dir: i === 0, size: 0 })));
  expect(sorted.map((n) => n.name)).toEqual(['z', 'a', 'B', 'Ä', '你']);
});
