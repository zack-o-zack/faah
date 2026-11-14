import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IgnoreSet, compilePattern, readGitignore } from '../src/ignore/service.ts';
import vectors from './ignore-vectors.json';

test('Go ignore patterns, negation and directory rules', () => {
  const ig = new IgnoreSet(['build/', '*.tmp', '!keep.tmp', 'docs/**/draft.md', '/only-root.txt']);
  const cases: [string, boolean, boolean][] = [
    ['.git', true, true],
    ['node_modules', true, true],
    ['src/main.go', false, false],
    ['build', true, true],
    ['build/out.js', false, true],
    ['a/b/c.tmp', false, true],
    ['a/b/keep.tmp', false, false],
    ['docs/x/y/draft.md', false, true],
    ['docs/draft.md', false, true],
    ['only-root.txt', false, true],
    ['sub/only-root.txt', false, false],
    ['vendor', true, true],
    ['src/vendor.go', false, false],
  ];
  for (const [path, dir, want] of cases) expect(ig.match(path, dir)).toBe(want);
  expect(ig.child([])).toBe(ig);
  expect(ig.child(['*.subtmp']).match('test.subtmp', false)).toBe(true);
  expect(ig.match('test.subtmp', false)).toBe(false);
  for (const p of ['', '   ', '# a comment']) expect(compilePattern(p)).toBeUndefined();
  expect(compilePattern('[')?.hit('[', false)).toBe(true);
  expect(compilePattern('!')?.negate).toBe(true);
});

test('all Go fast-path vectors equal the regex implementation', () => {
  for (const pattern of vectors.patterns)
    for (const suffix of ['', '/']) {
      const fast = compilePattern(pattern + suffix),
        slow = compilePattern(pattern + suffix, false);
      expect(Boolean(fast)).toBe(Boolean(slow));
      for (const path of vectors.paths)
        for (const dir of [false, true]) expect(fast?.hit(path, dir)).toBe(slow?.hit(path, dir));
    }
});

test('Go .gitignore scanning and scoped negation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'faah-ignore-'));
  try {
    expect(await readGitignore(join(dir, 'absent'), '')).toEqual([]);
    await writeFile(join(dir, '.gitignore'), '\n# comment\nfoo\n!bar\n/baz\n!/qux\n');
    expect(await readGitignore(dir, '')).toEqual(['foo', '!bar', '/baz', '!/qux']);
    expect(await readGitignore(dir, 'sub/dir')).toEqual([
      'sub/dir/foo',
      '!sub/dir/bar',
      'sub/dir/baz',
      '!sub/dir/qux',
    ]);
    const parent = new IgnoreSet(['*.tmp']);
    const child = parent.child(['!src/keep.tmp', 'src/*.tmp']);
    expect(child.match('src/keep.tmp', false)).toBe(true);
    expect(parent.match('src/keep.tmp', false)).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
