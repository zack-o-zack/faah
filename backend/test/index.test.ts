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
  const f = await workspace();
  try {
    await f.write('.gitignore', 'secret/\n*.tmp\n!keep.tmp\n');
    await f.write('main.go');
    await f.write('secret/keys.go');
    await f.write('secret/sub/nested.go');
    await f.write('root.tmp');
    await f.write('keep.tmp');
    await f.write('sub/.gitignore', 'local.txt\n!keep.tmp\n');
    await f.write('sub/local.txt');
    await f.write('sub/keep.tmp');
    await f.write('sub/deep/local.txt');
    await f.write('.git/HEAD');
    await f.write('.hg/store');
    await f.write('.svn/entries');
    await symlink(join(f.root, 'main.go'), join(f.root, 'link.go'));
    let release = () => {};
    const git = new Promise<GitState>((resolve) => {
      release = () => resolve(emptyGit());
    });
    const index = new Index({ root: f.root, gitState: () => git, updated: async () => {} });
    const build = index.build();
    while (!index.children.has('')) await Bun.sleep(1);
    expect(index.ready).toBe(false);
    expect(index.files).toEqual([]);
    expect((await index.list(''))?.some((n) => n.name === 'secret' && n.ignored)).toBe(true);
    release();
    await build;
    expect(index.ready).toBe(true);
    expect(index.files.map((f) => f.path)).toEqual([
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
    await f.close();
  }
});

test('Go compact all, changed and yours views retain the deepest directory flags', async () => {
  const f = await workspace();
  try {
    for (const path of ['one/two/three/abcd.ts', 'docs/a.md', 'docs/guide/b.md', 'top.txt'])
      await f.write(path);
    await f.index.build();
    expect((await f.index.compact('', 'all'))?.map((n) => [n.name, n.path])).toEqual([
      ['docs', 'docs'],
      ['one/two/three', 'one/two/three'],
      ['top.txt', 'top.txt'],
    ]);
    await f.index.applyGit({
      ...emptyGit(),
      git: true,
      statuses: { 'docs/guide/b.md': 'M', 'one/two/three/abcd.ts': 'U' },
      yourStatuses: { 'docs/guide/b.md': 'A' },
    });
    expect(
      (await f.index.compact('', 'changed'))?.find((n) => n.path === 'docs/guide'),
    ).toMatchObject({ name: 'docs/guide', dirty: true, yourDirty: true });
    expect((await f.index.compact('', 'yours'))?.find((n) => n.path === 'docs/guide')?.name).toBe(
      'docs/guide',
    );
    expect((await f.index.compact('', ''))?.find((n) => n.name === 'docs')?.path).toBe('docs');
    expect((await f.index.list(''))?.find((n) => n.name === 'docs')?.path).toBe('docs');
  } finally {
    await f.close();
  }
});

test('Go TouchPath inserts, updates and evicts paths without descending into ignored folders', async () => {
  const f = await workspace();
  try {
    await f.write('existing.go', 'package main\n');
    await f.write('.gitignore', 'ignored/\n*.tmp\n');
    await f.index.build();
    await f.write('sub/added.go', 'package sub\n');
    await f.index.touch('sub/added.go');
    expect((await f.index.list('sub'))?.map((n) => n.path)).toEqual(['sub/added.go']);
    expect(f.index.files.find((n) => n.path === 'sub/added.go')?.size).toBe(12);
    await f.write('sub/added.go', 'longer content\n');
    await f.index.touch('sub/added.go');
    expect(f.index.files.find((n) => n.path === 'sub/added.go')?.size).toBe(15);
    await f.write('ignored/no.go');
    await f.index.touch('ignored/no.go');
    expect(f.index.children.has('ignored')).toBe(false);
    await f.write('skip.tmp');
    await f.index.touch('skip.tmp');
    expect((await f.index.list(''))?.find((n) => n.name === 'skip.tmp')?.ignored).toBe(true);
    expect(f.index.files.some((n) => n.path === 'skip.tmp')).toBe(false);
    await rm(join(f.root, 'sub/added.go'));
    await f.index.touch('sub/added.go');
    expect(await f.index.list('sub')).toEqual([]);
    expect(f.index.files.some((n) => n.path === 'sub/added.go')).toBe(false);
    await f.index.touch('../escape');
    await f.index.touch('');
    await mkdir(join(f.root, 'empty'));
    await f.index.touch('empty');
    expect(await f.index.list('empty')).toEqual([]);
  } finally {
    await f.close();
  }
});

test('touching walked files preserves parallel search while file and parent symlinks fall back', async () => {
  const f = await workspace();
  const strategies: string[] = [];
  const search = new Search({
    root: f.root,
    files: () => f.index.files,
    strategy: 'walk',
    profile: (p) => strategies.push(p.strategy),
  });
  const query = () => search.search({ query: 'needle' }, AbortSignal.timeout(10000));
  try {
    await f.write('direct.txt', 'needle');
    await f.write('parent/file.txt', 'needle');
    await f.write('other/file.txt', 'needle');
    await f.index.build();
    await f.write('direct.txt', 'needle edited');
    await f.index.touch('direct.txt');
    expect(f.index.files.find((n) => n.path === 'direct.txt')?.walked).toBe(true);
    await query();
    expect(strategies.at(-1)).toBe('walk');
    await rm(join(f.root, 'direct.txt'));
    await symlink(join(f.root, 'other/file.txt'), join(f.root, 'direct.txt'));
    await f.index.touch('direct.txt');
    expect((await query()).results.some((n) => n.path === 'direct.txt')).toBe(true);
    expect(strategies.at(-1)).toBe('explicit');
    await f.index.build();
    await rm(join(f.root, 'parent'), { recursive: true });
    await symlink(join(f.root, 'other'), join(f.root, 'parent'));
    await f.index.touch('parent/file.txt');
    expect((await query()).results.some((n) => n.path === 'parent/file.txt')).toBe(true);
    expect(strategies.at(-1)).toBe('explicit');
  } finally {
    await f.close();
  }
});

test('Go Git overlays inject deleted files, track staged/partial and clean committed deletions', async () => {
  const f = await workspace();
  try {
    await f.write('present.go');
    await f.index.build();
    const state: GitState = {
      git: true,
      statuses: { 'gone/deep/file.go': 'D', 'present.go': 'M', 'new.txt': 'U' },
      staged: { 'present.go': true },
      partial: { 'present.go': true },
      yourStatuses: { 'gone/deep/file.go': 'D' },
    };
    await f.index.applyGit(state);
    expect(f.index.gitFiles).toEqual(['gone/deep/file.go', 'present.go', 'new.txt']);
    expect((await f.index.list('gone/deep'))?.[0]).toMatchObject({
      status: 'D',
      yourStatus: 'D',
      size: 0,
    });
    expect((await f.index.list(''))?.find((n) => n.path === 'present.go')).toMatchObject({
      status: 'M',
      staged: true,
      partial: true,
    });
    await f.index.applyGit(emptyGit());
    expect(await f.index.list('gone')).toBeUndefined();
    expect((await f.index.list(''))?.find((n) => n.path === 'present.go')).toEqual({
      name: 'present.go',
      path: 'present.go',
      dir: false,
      size: 1,
    });
  } finally {
    await f.close();
  }
});

test('sortNodes puts directories first and compares folded UTF-8 names', () => {
  const names = ['z', 'Ä', 'a', '你', 'B'];
  const sorted = sortNodes(names.map((name, i) => ({ name, path: name, dir: i === 0, size: 0 })));
  expect(sorted.map((n) => n.name)).toEqual(['z', 'a', 'B', 'Ä', '你']);
});
