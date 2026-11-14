import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { walk } from '../src/index/walk.ts';
import { Search, unindexedTarget } from '../src/search/service.ts';
import { snip } from '../src/search/snip.ts';

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'faah-search-'));
  async function write(path: string, content: string | Uint8Array) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  await write('.gitignore', 'ignored/\n');
  await write('plain.txt', 'needle NEEDLE needles\n你好 needle\nK k K S s ſ É é İ i\n');
  await write('ignored/secret.txt', 'needle\n');
  await write('empty.txt', '');
  await write('binary.bin', Buffer.from('needle\0needle'));
  await write('late-null.txt', 'needle\n' + 'x'.repeat(8001) + '\0needle');
  await write('large.txt', 'needle'.repeat(1400000));
  await write('src/hello.go', 'package hello\nfunc Hello() { Hello(); Hello() }\n');
  await write('other/hello.go', 'Hello()\n');
  await symlink(join(root, 'plain.txt'), join(root, 'link.txt'));
  const index = await walk({ root, publish: () => {} });
  return {
    root,
    write,
    files: index.files,
    search: new Search({ root, files: () => index.files }),
    close: () => rm(root, { recursive: true, force: true }),
  };
}

test('search uses indexed set, literal ASCII folding, Unicode regex and Go word boundaries', async () => {
  const f = await workspace();
  const signal = AbortSignal.timeout(10000);
  try {
    const search = (
      query: string,
      opts: { case?: boolean; word?: boolean; regex?: boolean; glob?: string } = {},
    ) => f.search.search({ query, ...opts }, signal);
    const literal = await search('needle');
    expect(literal.results.map((r) => r.path)).toEqual(['late-null.txt', 'plain.txt']);
    expect(literal.results.find((r) => r.path === 'plain.txt')?.matches.length).toBe(4);
    expect(
      (await search('needle', { case: true, glob: 'plain.txt' })).results[0]?.matches.length,
    ).toBe(3);
    expect(
      (await search('needle', { word: true, glob: 'plain.txt' })).results[0]?.matches.length,
    ).toBe(3);
    expect(
      (await search('k', { glob: 'plain.txt' })).results[0]?.matches.map((m) => m.mid),
    ).toEqual(['K', 'k']);
    expect(
      (await search('k|s|é', { regex: true, glob: 'plain.txt' })).results[0]?.matches.map(
        (m) => m.mid,
      ),
    ).toEqual(['s', 'K', 'k', 'K', 'S', 's', 'ſ', 'É', 'é']);
    expect((await search('你好', { glob: 'plain.txt' })).results[0]?.matches[0]?.mid).toBe('你好');
    expect(
      (await search('needle', { glob: 'ignored/secret.txt' })).results.map((f) => f.path),
    ).toEqual(['ignored/secret.txt']);
    for (const glob of [
      'ignored/*',
      'ignored/../ignored/secret.txt',
      'link.txt',
      'ignored//secret.txt',
    ])
      expect((await search('needle', { glob })).results).toEqual([]);
    expect((await search('Hello', { glob: 'src/*.go' })).results.map((f) => f.path)).toEqual([
      'src/hello.go',
    ]);
    expect((await search('   ')).results).toEqual([]);
    expect(await unindexedTarget(f.root, f.files, '/ignored/secret.txt')).toBeDefined();
    expect(await f.search.definitions('Hello', signal)).toMatchObject({
      symbol: 'Hello',
      refCount: 1,
      defs: [{ path: 'src/hello.go', line: 2, def: true }],
    });
  } finally {
    await f.close();
  }
});

test('search caps matches per file and returns 200 complete files without claiming per-file truncation', async () => {
  const f = await workspace();
  try {
    await f.write('caps.txt', 'capneedle '.repeat(100));
    const state = await walk({ root: f.root, publish: () => {} });
    const search = new Search({ root: f.root, files: () => state.files });
    const perFile = await search.search({ query: 'capneedle' }, AbortSignal.timeout(10000));
    expect(perFile.results[0]?.matches.length).toBe(50);
    expect(perFile.truncated).toBe(false);
    for (let i = 0; i < 201; i++)
      await f.write(`caps/${String(i).padStart(3, '0')}.txt`, 'filecapneedle\n'.repeat(60));
    state.files = (await walk({ root: f.root, publish: () => {} })).files;
    const cap = await search.search({ query: 'filecapneedle' }, AbortSignal.timeout(10000));
    expect(cap.results.length).toBe(200);
    expect(cap.results.every((f) => f.matches.length === 50)).toBe(true);
  } finally {
    await f.close();
  }
});

test('search aborts ripgrep and rejects invalid expressions', async () => {
  const f = await workspace();
  try {
    await expect(
      f.search.search({ query: '[', regex: true }, AbortSignal.timeout(10000)),
    ).rejects.toThrow('error parsing regexp: missing closing ]: `[`');
    const controller = new AbortController();
    controller.abort();
    await expect(f.search.search({ query: 'needle' }, controller.signal)).rejects.toThrow();
    const pending = f.search.search({ query: 'needle' }, AbortSignal.timeout(1));
    await expect(pending).rejects.toThrow();
  } finally {
    await f.close();
  }
});

test('Go line anchors, empty matches, quoted literals and newline expressions', async () => {
  const f = await workspace();
  const signal = AbortSignal.timeout(10000);
  try {
    for (const query of ['^', '$', '\\A', '\\z']) {
      const result = await f.search.search({ query, regex: true, glob: 'plain.txt' }, signal);
      expect(result.results[0]?.matches.map((m) => m.line)).toEqual([1, 2, 3, 4]);
    }
    for (const query of ['a*', 'a?', '\\B']) {
      const result = await f.search.search({ query, regex: true, glob: 'plain.txt' }, signal);
      expect(
        result.results
          .flatMap((f) => f.matches)
          .every((m) => !m.pre.includes('�') && !m.post.includes('�')),
      ).toBe(true);
    }
    for (const query of ['a\\nb', 'a\nb', '\\Q[a]\\E'])
      expect(
        (await f.search.search({ query, regex: true, glob: 'plain.txt' }, signal)).results,
      ).toEqual([]);
    expect((await f.search.search({ query: 'a\nb', glob: 'plain.txt' }, signal)).results).toEqual(
      [],
    );
    expect(
      (await f.search.search({ query: '[\\w]+', regex: true, glob: 'plain.txt' }, signal))
        .results[0]?.matches[0]?.mid,
    ).toBe('needle');
    expect(
      (await f.search.search({ query: '[a\\n]', regex: true, glob: 'plain.txt' }, signal)).results
        .length,
    ).toBe(0);
    await expect(f.search.search({ query: '(', regex: true }, signal)).rejects.toThrow(
      'missing closing ): `(?i)(`',
    );
    await expect(f.search.search({ query: '(?=a)', regex: true }, signal)).rejects.toThrow(
      'invalid or unsupported Perl syntax: `(?=`',
    );
    await expect(f.search.search({ query: 'a{1001}', regex: true }, signal)).rejects.toThrow(
      'invalid repeat count: `{1001}`',
    );
  } finally {
    await f.close();
  }
});

test('Go snip trims indentation, clamps bytes and budgets Unicode runes', () => {
  const cut = (line: string, from: number, to: number) =>
    snip({ line: Buffer.from(line), from, to });
  expect(cut('hello world', -5, 100)).toEqual({ pre: '', mid: 'hello world', post: '' });
  expect(cut('hello world', 8, 3).mid).toBe('');
  expect(cut('\t  hello world  ', 9, 14)).toEqual({ pre: 'hello ', mid: 'world', post: '' });
  expect(cut('a'.repeat(40) + 'needle' + 'b'.repeat(300), 40, 46)).toEqual({
    pre: '…' + 'a'.repeat(16),
    mid: 'needle',
    post: 'b'.repeat(217) + '…',
  });
  expect(cut('你'.repeat(40) + '好' + '世'.repeat(300), 120, 123)).toEqual({
    pre: '…' + '你'.repeat(16),
    mid: '好',
    post: '世'.repeat(222) + '…',
  });
  expect(cut('x'.repeat(300), 0, 300)).toEqual({ pre: '', mid: 'x'.repeat(240) + '…', post: '' });
});
