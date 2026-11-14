import { expect, test } from 'bun:test';
import { rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gitFixture } from './git-fixture.ts';
import { GitProbe } from '../src/git/probe.ts';
import { GitLinks } from '../src/git/links.ts';
import { NotFastForward } from '../src/git/mutations.ts';

test('Go repository status preserves deleted, renamed, staged, partial, untracked and subtree paths', async () => {
  const repo = await gitFixture();
  try {
    for (const [path, text] of [
      ['keep.go', 'keep\n'],
      ['sub/mod.go', 'one\n'],
      ['del.go', 'del\n'],
      ['sub/ren.go', 'old\n'],
    ])
      await repo.write(path ?? '', text ?? '');
    await repo.run('add', '-A');
    await repo.run('commit', '-qm', 'init');
    await repo.write('sub/mod.go', 'two\n');
    await repo.write('add.go', 'added\n');
    await repo.run('add', 'add.go');
    await repo.write('untr.go', 'untracked\n');
    await rm(join(repo.root, 'del.go'));
    await repo.run('mv', 'sub/ren.go', 'sub/ren2.go');
    expect((await repo.status.read(repo.root)).statuses).toEqual({
      'sub/mod.go': 'M',
      'add.go': 'A',
      'untr.go': 'U',
      'del.go': 'D',
      'sub/ren2.go': 'R',
    });
    expect((await repo.status.read(join(repo.root, 'sub'))).statuses).toEqual({
      'mod.go': 'M',
      'ren2.go': 'R',
    });
    await repo.mutations.stage(repo.root, 'sub/mod.go');
    await repo.write('sub/mod.go', 'three\n');
    const partial = await repo.status.read(repo.root);
    expect(partial.partial).toEqual({ 'sub/mod.go': true });
    expect(partial.staged['sub/mod.go']).toBe(true);
    expect(await repo.diff.against(repo.root, 'sub/mod.go')).toContain('+three');
    await repo.mutations.unstage(repo.root, 'sub/mod.go');
    expect((await repo.status.read(repo.root)).partial).toEqual({});
  } finally {
    await repo.cleanup();
  }
});

test('probe retries non-Git roots, recognizes later init, caches successful roots and obeys no-git', async () => {
  const repo = await gitFixture();
  try {
    expect(await repo.commands.probe.get(repo.root)).toBeDefined();
    await rm(join(repo.root, '.git'), { recursive: true });
    expect(await repo.commands.probe.get(repo.root)).toBeUndefined();
    await repo.run('init', '-q', '-b', 'main');
    expect(await repo.commands.probe.get(repo.root)).toBeDefined();
    expect(await new GitProbe(repo.processes, false).get(repo.root)).toBeUndefined();
    const first = await repo.commands.probe.get(repo.root);
    expect(await repo.commands.probe.get(repo.root)).toBe(first);
  } finally {
    await repo.cleanup();
  }
});

test('unborn HEAD stages and unstages without changing working content, and diffs against the empty tree', async () => {
  const repo = await gitFixture();
  try {
    expect(await repo.sync.branch(repo.root)).toBe('main');
    await repo.write('-odd name\t😀', 'new\n');
    await repo.mutations.stage(repo.root, '-odd name\t😀');
    expect(await repo.mutations.staged(repo.root)).toEqual(['-odd name\t😀']);
    expect(await repo.diff.against(repo.root, '-odd name\t😀')).toContain('+new');
    await repo.mutations.unstage(repo.root, '-odd name\t😀');
    expect(await repo.mutations.staged(repo.root)).toEqual([]);
    expect(await readFile(join(repo.root, '-odd name\t😀'), 'utf8')).toBe('new\n');
    await expect(repo.mutations.commit(repo.root, 'empty')).rejects.toThrow(
      'nothing staged to commit',
    );
  } finally {
    await repo.cleanup();
  }
});

test('history handles root commits, frozen diffs, binary stats, multiline bodies and author links', async () => {
  const repo = await gitFixture();
  try {
    await repo.write('a.txt', 'one\ntwo\n');
    await repo.mutations.stage(repo.root, '.');
    await repo.mutations.commit(repo.root, 'root');
    const first = await repo.run('rev-parse', 'HEAD');
    expect((await repo.history.files(repo.root, first))[0]).toMatchObject({
      path: 'a.txt',
      status: 'A',
      add: 2,
      del: 0,
    });
    await repo.write('a.txt', 'one\nTWO\nthree\n');
    await repo.write('image.bin', Uint8Array.from([0, 1, 2, 0]));
    await repo.mutations.stage(repo.root, '.');
    await repo.mutations.commit(repo.root, 'subject\n\nbody\x1fkeep separator');
    const head = await repo.run('rev-parse', 'HEAD'),
      files = await repo.history.files(repo.root, head);
    expect(files.find((file) => file.path === 'a.txt')).toMatchObject({
      status: 'M',
      add: 2,
      del: 1,
    });
    expect(files.find((file) => file.path === 'image.bin')).toMatchObject({
      binary: true,
      add: 0,
      del: 0,
    });
    const frozen = await repo.diff.commit(repo.root, 'a.txt', head);
    await repo.write('a.txt', 'later\n');
    expect(await repo.diff.commit(repo.root, 'a.txt', head)).toBe(frozen);
    expect(await repo.diff.commit(repo.root, 'a.txt', first)).toContain('+one');
    await repo.run('remote', 'add', 'origin', 'git@github.com:alice/repo.git');
    const detail = await repo.history.detail(repo.root, head);
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
      await new GitLinks(repo.commands).author(
        repo.root,
        '12345+octocat@users.noreply.github.com',
        'Octo',
      ),
    ).toBe('https://github.com/octocat');
    expect(await repo.history.files(repo.root, 'HEAD~1')).toEqual([]);
    expect(await repo.history.detail(repo.root, 'deadbeefdeadbeef')).toBeUndefined();
    expect((await repo.history.recent(repo.root))[0]?.full).toBe(head);
    expect((await repo.history.unpushed(repo.root)).commits).toEqual([]);
  } finally {
    await repo.cleanup();
  }
});

test('merge reads preserve Go show and diff-tree count differences', async () => {
  const repo = await gitFixture();
  try {
    await repo.write('a', 'base\n');
    await repo.run('add', '-A');
    await repo.run('commit', '-qm', 'base');
    await repo.run('checkout', '-qb', 'side');
    await repo.write('side', 'a\nb\n');
    await repo.run('add', '-A');
    await repo.run('commit', '-qm', 'side work');
    await repo.run('checkout', '-q', 'main');
    await repo.write('a', 'main\n');
    await repo.run('commit', '-qam', 'main work');
    await repo.run('merge', '-q', '--no-ff', '-m', 'merge side', 'side');
    const head = await repo.run('rev-parse', 'HEAD');
    expect([...(await repo.history.numstat(repo.root, head))]).toEqual([
      ['side', { add: 2, del: 0, binary: false }],
    ]);
    // Preserve Go's diff-tree argv: unlike show --numstat, this form counts
    // both merge-parent diffs on the installed Git version.
    expect(await repo.history.stat(repo.root, head)).toEqual({
      files: 2,
      insertions: 3,
      deletions: 1,
    });
  } finally {
    await repo.cleanup();
  }
});

test('hunk stage, unstage and discard keep working files and the index separate', async () => {
  const repo = await gitFixture();
  try {
    await repo.write('sub/a', 'one\ntwo\n');
    await repo.run('add', '-A');
    await repo.run('commit', '-qm', 'base');
    await repo.write('sub/a', 'one\nTWO\n');
    const patch = '@@ -2 +2 @@\n-two\n+TWO\n';
    await repo.mutations.hunk(join(repo.root, 'sub'), 'a', patch, 'stage');
    expect((await repo.status.read(repo.root)).staged['sub/a']).toBe(true);
    await repo.mutations.hunk(repo.root, 'sub/a', patch, 'unstage');
    expect((await repo.status.read(repo.root)).staged['sub/a']).toBeUndefined();
    await repo.mutations.hunk(repo.root, 'sub/a', patch, 'discard');
    expect(await readFile(join(repo.root, 'sub/a'), 'utf8')).toBe('one\ntwo\n');
    await expect(repo.mutations.hunk(repo.root, 'sub/a', 'bad', 'stage')).rejects.toThrow(
      'hunk must start',
    );
  } finally {
    await repo.cleanup();
  }
});

test('ahead/behind falls back for unpublished branches, while unpushed requires a real upstream', async () => {
  const repo = await gitFixture();
  try {
    await repo.write('a', 'base\n');
    await repo.run('add', '-A');
    await repo.run('commit', '-qm', 'base');
    expect(await repo.sync.aheadBehind(repo.root)).toEqual({
      ahead: 0,
      behind: 0,
      hasUpstream: false,
    });
    await repo.run('init', '--bare', join(repo.root, 'remote.git'));
    await repo.run('remote', 'add', 'origin', join(repo.root, 'remote.git'));
    expect(await repo.sync.aheadBehind(repo.root)).toEqual({
      ahead: 1,
      behind: 0,
      hasUpstream: false,
    });
    expect((await repo.history.unpushed(repo.root)).commits).toEqual([]);
    expect((await repo.mutations.push(repo.root, 'origin', 'main')).code).toBe(0);
    await repo.write('a', 'next\n');
    await repo.run('commit', '-qam', 'next');
    expect(await repo.sync.aheadBehind(repo.root)).toEqual({
      ahead: 1,
      behind: 0,
      hasUpstream: true,
    });
    expect((await repo.history.unpushed(repo.root)).commits).toHaveLength(1);
  } finally {
    await repo.cleanup();
  }
});

test('operation priority, rebasing branch and no-op abort match Go', async () => {
  const repo = await gitFixture();
  try {
    await expect(repo.mutations.abort(repo.root)).rejects.toThrow('no rebase or merge');
    await repo.write('.git/MERGE_HEAD', 'fake');
    expect(await repo.sync.operation(repo.root)).toBe('merge');
    await mkdir(join(repo.root, '.git/rebase-apply'));
    await repo.write('.git/rebase-apply/head-name', 'refs/heads/topic\n');
    expect(await repo.sync.operation(repo.root)).toBe('rebase');
    expect(await repo.sync.rebasingBranch(repo.root)).toBe('topic');
  } finally {
    await repo.cleanup();
  }
});

test('fast-forward pull fetches local remotes and refuses divergence without moving HEAD', async () => {
  const repo = await gitFixture();
  try {
    const remote = join(repo.root, 'remote.git'),
      peer = join(repo.root, 'peer');
    const at = async (...args: string[]) => {
      const result = await repo.processes.run(peer, args);
      if (result.code) throw new Error(result.output);
    };
    await repo.write('a', 'base\n');
    await repo.run('add', '-A');
    await repo.run('commit', '-qm', 'base');
    await repo.run('init', '--bare', '-b', 'main', remote);
    await repo.run('remote', 'add', 'origin', remote);
    expect((await repo.mutations.push(repo.root, 'origin', 'main')).code).toBe(0);
    await repo.run('clone', '-q', remote, peer);
    await writeFile(join(peer, 'a'), 'remote\n');
    await at('commit', '-qam', 'remote');
    await at('push', '-q', 'origin', 'main');
    await repo.mutations.pull(repo.root, 'origin', 'main');
    expect(await readFile(join(repo.root, 'a'), 'utf8')).toBe('remote\n');
    await repo.write('a', 'local\n');
    await repo.run('commit', '-qam', 'local');
    const before = await repo.run('rev-parse', 'HEAD');
    await writeFile(join(peer, 'a'), 'remote again\n');
    await at('commit', '-qam', 'remote again');
    await at('push', '-q', 'origin', 'main');
    await expect(repo.mutations.pull(repo.root, 'origin', 'main')).rejects.toBeInstanceOf(
      NotFastForward,
    );
    expect(await repo.run('rev-parse', 'HEAD')).toBe(before);
    expect(await repo.sync.aheadBehind(repo.root)).toEqual({
      ahead: 1,
      behind: 1,
      hasUpstream: true,
    });
  } finally {
    await repo.cleanup();
  }
});

test('abort restores real conflicted merges and rebases to their original branch and content', async () => {
  const repo = await gitFixture();
  try {
    await repo.write('a', 'base\n');
    await repo.run('add', '-A');
    await repo.run('commit', '-qm', 'base');
    await repo.run('checkout', '-qb', 'side');
    await repo.write('a', 'side\n');
    await repo.run('commit', '-qam', 'side');
    await repo.run('checkout', '-q', 'main');
    await repo.write('a', 'main\n');
    await repo.run('commit', '-qam', 'main');
    const before = await repo.run('rev-parse', 'HEAD');
    expect(
      (await repo.processes.run(repo.root, ['merge', '-m', 'merge side', 'side'])).code,
    ).not.toBe(0);
    expect(await repo.sync.operation(repo.root)).toBe('merge');
    await repo.mutations.abort(repo.root);
    expect(await repo.run('rev-parse', 'HEAD')).toBe(before);
    expect(await repo.sync.operation(repo.root)).toBe('');
    expect((await repo.processes.run(repo.root, ['rebase', 'side'])).code).not.toBe(0);
    expect(await repo.sync.operation(repo.root)).toBe('rebase');
    expect(await repo.sync.rebasingBranch(repo.root)).toBe('main');
    await repo.mutations.abort(repo.root);
    expect(await repo.sync.branch(repo.root)).toBe('main');
    expect(await repo.run('rev-parse', 'HEAD')).toBe(before);
    expect(await readFile(join(repo.root, 'a'), 'utf8')).toBe('main\n');
  } finally {
    await repo.cleanup();
  }
});
