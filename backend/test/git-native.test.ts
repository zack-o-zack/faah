import { expect, test } from 'bun:test';
import { rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gitFixture } from './git-fixture.ts';
import { GitProbe } from '../src/git/probe.ts';
import { GitLinks } from '../src/git/links.ts';
import { NotFastForward } from '../src/git/mutations.ts';

test('Go repository status preserves deleted, renamed, staged, partial, untracked and subtree paths', async () => {
  const f = await gitFixture();
  try {
    for (const [path, text] of [
      ['keep.go', 'keep\n'],
      ['sub/mod.go', 'one\n'],
      ['del.go', 'del\n'],
      ['sub/ren.go', 'old\n'],
    ])
      await f.write(path ?? '', text ?? '');
    await f.run('add', '-A');
    await f.run('commit', '-qm', 'init');
    await f.write('sub/mod.go', 'two\n');
    await f.write('add.go', 'added\n');
    await f.run('add', 'add.go');
    await f.write('untr.go', 'untracked\n');
    await rm(join(f.root, 'del.go'));
    await f.run('mv', 'sub/ren.go', 'sub/ren2.go');
    expect((await f.status.read(f.root)).statuses).toEqual({
      'sub/mod.go': 'M',
      'add.go': 'A',
      'untr.go': 'U',
      'del.go': 'D',
      'sub/ren2.go': 'R',
    });
    expect((await f.status.read(join(f.root, 'sub'))).statuses).toEqual({
      'mod.go': 'M',
      'ren2.go': 'R',
    });
    await f.mutations.stage(f.root, 'sub/mod.go');
    await f.write('sub/mod.go', 'three\n');
    const partial = await f.status.read(f.root);
    expect(partial.partial).toEqual({ 'sub/mod.go': true });
    expect(partial.staged['sub/mod.go']).toBe(true);
    expect(await f.diff.against(f.root, 'sub/mod.go')).toContain('+three');
    await f.mutations.unstage(f.root, 'sub/mod.go');
    expect((await f.status.read(f.root)).partial).toEqual({});
  } finally {
    await f.cleanup();
  }
});

test('probe retries non-Git roots, recognizes later init, caches successful roots and obeys no-git', async () => {
  const f = await gitFixture();
  try {
    expect(await f.commands.probe.get(f.root)).toBeDefined();
    await rm(join(f.root, '.git'), { recursive: true });
    expect(await f.commands.probe.get(f.root)).toBeUndefined();
    await f.run('init', '-q', '-b', 'main');
    expect(await f.commands.probe.get(f.root)).toBeDefined();
    expect(await new GitProbe(f.processes, false).get(f.root)).toBeUndefined();
    const first = await f.commands.probe.get(f.root);
    expect(await f.commands.probe.get(f.root)).toBe(first);
  } finally {
    await f.cleanup();
  }
});

test('unborn HEAD stages and unstages without changing working content, and diffs against the empty tree', async () => {
  const f = await gitFixture();
  try {
    expect(await f.sync.branch(f.root)).toBe('main');
    await f.write('-odd name\t😀', 'new\n');
    await f.mutations.stage(f.root, '-odd name\t😀');
    expect(await f.mutations.staged(f.root)).toEqual(['-odd name\t😀']);
    expect(await f.diff.against(f.root, '-odd name\t😀')).toContain('+new');
    await f.mutations.unstage(f.root, '-odd name\t😀');
    expect(await f.mutations.staged(f.root)).toEqual([]);
    expect(await readFile(join(f.root, '-odd name\t😀'), 'utf8')).toBe('new\n');
    await expect(f.mutations.commit(f.root, 'empty')).rejects.toThrow('nothing staged to commit');
  } finally {
    await f.cleanup();
  }
});

test('history handles root commits, frozen diffs, binary stats, multiline bodies and author links', async () => {
  const f = await gitFixture();
  try {
    await f.write('a.txt', 'one\ntwo\n');
    await f.mutations.stage(f.root, '.');
    await f.mutations.commit(f.root, 'root');
    const first = await f.run('rev-parse', 'HEAD');
    expect((await f.history.files(f.root, first))[0]).toMatchObject({
      path: 'a.txt',
      status: 'A',
      add: 2,
      del: 0,
    });
    await f.write('a.txt', 'one\nTWO\nthree\n');
    await f.write('image.bin', Uint8Array.from([0, 1, 2, 0]));
    await f.mutations.stage(f.root, '.');
    await f.mutations.commit(f.root, 'subject\n\nbody\x1fkeep separator');
    const head = await f.run('rev-parse', 'HEAD'),
      files = await f.history.files(f.root, head);
    expect(files.find((x) => x.path === 'a.txt')).toMatchObject({ status: 'M', add: 2, del: 1 });
    expect(files.find((x) => x.path === 'image.bin')).toMatchObject({
      binary: true,
      add: 0,
      del: 0,
    });
    const frozen = await f.diff.commit(f.root, 'a.txt', head);
    await f.write('a.txt', 'later\n');
    expect(await f.diff.commit(f.root, 'a.txt', head)).toBe(frozen);
    expect(await f.diff.commit(f.root, 'a.txt', first)).toContain('+one');
    await f.run('remote', 'add', 'origin', 'git@github.com:alice/repo.git');
    const detail = await f.history.detail(f.root, head);
    expect(detail).toMatchObject({
      hash: head,
      files: 2,
      insertions: 2,
      deletions: 1,
      message: 'subject\n\nbody\x1fkeep separator',
      dateIso: '2020-01-02T03:04:05Z',
      authorUrl: 'https://github.com/alice/repo/commits?author=t%40example.com',
      commitUrl: 'https://github.com/alice/repo/commit/' + head,
    });
    expect(
      await new GitLinks(f.commands).author(
        f.root,
        '12345+octocat@users.noreply.github.com',
        'Octo',
      ),
    ).toBe('https://github.com/octocat');
    expect(await f.history.files(f.root, 'HEAD~1')).toEqual([]);
    expect(await f.history.detail(f.root, 'deadbeefdeadbeef')).toBeUndefined();
    expect((await f.history.recent(f.root))[0]?.full).toBe(head);
    expect((await f.history.unpushed(f.root)).commits).toEqual([]);
  } finally {
    await f.cleanup();
  }
});

test('merge reads preserve Go show and diff-tree count differences', async () => {
  const f = await gitFixture();
  try {
    await f.write('a', 'base\n');
    await f.run('add', '-A');
    await f.run('commit', '-qm', 'base');
    await f.run('checkout', '-qb', 'side');
    await f.write('side', 'a\nb\n');
    await f.run('add', '-A');
    await f.run('commit', '-qm', 'side work');
    await f.run('checkout', '-q', 'main');
    await f.write('a', 'main\n');
    await f.run('commit', '-qam', 'main work');
    await f.run('merge', '-q', '--no-ff', '-m', 'merge side', 'side');
    const head = await f.run('rev-parse', 'HEAD');
    expect([...(await f.history.numstat(f.root, head))]).toEqual([
      ['side', { add: 2, del: 0, binary: false }],
    ]);
    // Preserve Go's diff-tree argv: unlike show --numstat, this form counts
    // both merge-parent diffs on the installed Git version.
    expect(await f.history.stat(f.root, head)).toEqual({ files: 2, insertions: 3, deletions: 1 });
  } finally {
    await f.cleanup();
  }
});

test('hunk stage, unstage and discard keep working files and the index separate', async () => {
  const f = await gitFixture();
  try {
    await f.write('sub/a', 'one\ntwo\n');
    await f.run('add', '-A');
    await f.run('commit', '-qm', 'base');
    await f.write('sub/a', 'one\nTWO\n');
    const patch = '@@ -2 +2 @@\n-two\n+TWO\n';
    await f.mutations.hunk(join(f.root, 'sub'), 'a', patch, 'stage');
    expect((await f.status.read(f.root)).staged['sub/a']).toBe(true);
    await f.mutations.hunk(f.root, 'sub/a', patch, 'unstage');
    expect((await f.status.read(f.root)).staged['sub/a']).toBeUndefined();
    await f.mutations.hunk(f.root, 'sub/a', patch, 'discard');
    expect(await readFile(join(f.root, 'sub/a'), 'utf8')).toBe('one\ntwo\n');
    await expect(f.mutations.hunk(f.root, 'sub/a', 'bad', 'stage')).rejects.toThrow(
      'hunk must start',
    );
  } finally {
    await f.cleanup();
  }
});

test('ahead/behind falls back for unpublished branches, while unpushed requires a real upstream', async () => {
  const f = await gitFixture();
  try {
    await f.write('a', 'base\n');
    await f.run('add', '-A');
    await f.run('commit', '-qm', 'base');
    expect(await f.sync.aheadBehind(f.root)).toEqual({ ahead: 0, behind: 0, hasUpstream: false });
    await f.run('init', '--bare', join(f.root, 'remote.git'));
    await f.run('remote', 'add', 'origin', join(f.root, 'remote.git'));
    expect(await f.sync.aheadBehind(f.root)).toEqual({ ahead: 1, behind: 0, hasUpstream: false });
    expect((await f.history.unpushed(f.root)).commits).toEqual([]);
    expect((await f.mutations.push(f.root, 'origin', 'main')).code).toBe(0);
    await f.write('a', 'next\n');
    await f.run('commit', '-qam', 'next');
    expect(await f.sync.aheadBehind(f.root)).toEqual({ ahead: 1, behind: 0, hasUpstream: true });
    expect((await f.history.unpushed(f.root)).commits).toHaveLength(1);
  } finally {
    await f.cleanup();
  }
});

test('operation priority, rebasing branch and no-op abort match Go', async () => {
  const f = await gitFixture();
  try {
    await expect(f.mutations.abort(f.root)).rejects.toThrow('no rebase or merge');
    await f.write('.git/MERGE_HEAD', 'fake');
    expect(await f.sync.operation(f.root)).toBe('merge');
    await mkdir(join(f.root, '.git/rebase-apply'));
    await f.write('.git/rebase-apply/head-name', 'refs/heads/topic\n');
    expect(await f.sync.operation(f.root)).toBe('rebase');
    expect(await f.sync.rebasingBranch(f.root)).toBe('topic');
  } finally {
    await f.cleanup();
  }
});

test('fast-forward pull fetches local remotes and refuses divergence without moving HEAD', async () => {
  const f = await gitFixture();
  try {
    const remote = join(f.root, 'remote.git'),
      peer = join(f.root, 'peer');
    const at = async (...args: string[]) => {
      const result = await f.processes.run(peer, args);
      if (result.code) throw new Error(result.output);
    };
    await f.write('a', 'base\n');
    await f.run('add', '-A');
    await f.run('commit', '-qm', 'base');
    await f.run('init', '--bare', '-b', 'main', remote);
    await f.run('remote', 'add', 'origin', remote);
    expect((await f.mutations.push(f.root, 'origin', 'main')).code).toBe(0);
    await f.run('clone', '-q', remote, peer);
    await writeFile(join(peer, 'a'), 'remote\n');
    await at('commit', '-qam', 'remote');
    await at('push', '-q', 'origin', 'main');
    await f.mutations.pull(f.root, 'origin', 'main');
    expect(await readFile(join(f.root, 'a'), 'utf8')).toBe('remote\n');
    await f.write('a', 'local\n');
    await f.run('commit', '-qam', 'local');
    const before = await f.run('rev-parse', 'HEAD');
    await writeFile(join(peer, 'a'), 'remote again\n');
    await at('commit', '-qam', 'remote again');
    await at('push', '-q', 'origin', 'main');
    await expect(f.mutations.pull(f.root, 'origin', 'main')).rejects.toBeInstanceOf(NotFastForward);
    expect(await f.run('rev-parse', 'HEAD')).toBe(before);
    expect(await f.sync.aheadBehind(f.root)).toEqual({ ahead: 1, behind: 1, hasUpstream: true });
  } finally {
    await f.cleanup();
  }
});

test('abort restores real conflicted merges and rebases to their original branch and content', async () => {
  const f = await gitFixture();
  try {
    await f.write('a', 'base\n');
    await f.run('add', '-A');
    await f.run('commit', '-qm', 'base');
    await f.run('checkout', '-qb', 'side');
    await f.write('a', 'side\n');
    await f.run('commit', '-qam', 'side');
    await f.run('checkout', '-q', 'main');
    await f.write('a', 'main\n');
    await f.run('commit', '-qam', 'main');
    const before = await f.run('rev-parse', 'HEAD');
    expect((await f.processes.run(f.root, ['merge', '-m', 'merge side', 'side'])).code).not.toBe(0);
    expect(await f.sync.operation(f.root)).toBe('merge');
    await f.mutations.abort(f.root);
    expect(await f.run('rev-parse', 'HEAD')).toBe(before);
    expect(await f.sync.operation(f.root)).toBe('');
    expect((await f.processes.run(f.root, ['rebase', 'side'])).code).not.toBe(0);
    expect(await f.sync.operation(f.root)).toBe('rebase');
    expect(await f.sync.rebasingBranch(f.root)).toBe('main');
    await f.mutations.abort(f.root);
    expect(await f.sync.branch(f.root)).toBe('main');
    expect(await f.run('rev-parse', 'HEAD')).toBe(before);
    expect(await readFile(join(f.root, 'a'), 'utf8')).toBe('main\n');
  } finally {
    await f.cleanup();
  }
});
