import grammars from '../src/render/grammars.json';
import languageVectors from './render-languages.json';
import { test, expect, spyOn } from 'bun:test';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Document, windowBytes } from '../src/render/document.ts';
import { plain, visualWidth } from '../src/render/html.ts';
import { language, filenameLanguage, fenceLanguage } from '../src/render/language.ts';
import { classFor, classes } from '../src/render/scopes.ts';
import { LRU } from '../src/render/lru.ts';
import { RenderDisk } from '../src/render/disk.ts';
import { RenderService } from '../src/render/service.ts';
import { IdleScavenger } from '../src/render/idle.ts';
import { engine } from '../src/render/engine.ts';
import { highlightedText } from '../../test/contract/highlight.ts';
test('recognized lexers normalize lone CRs while the no-lexer fallback preserves them', async () => {
  const highlight = await engine();
  expect(await highlight('line\rnext', 'plaintext', 1)).toEqual(['line']);
  expect(await highlight('line\rnext', 'plain text', 1)).toEqual(['line\rnext']);
});
test('Chroma filename names, aliases, priorities, backups, and content analysis', () => {
  for (const [path, name] of [
    ['x.go', 'Go'],
    ['x.ts', 'TypeScript'],
    ['x.tsx', 'TypeScript'],
    ['x.py', 'Python'],
    ['x.rs', 'Rust'],
    ['x.c', 'C'],
    ['x.h', 'C'],
    ['x.cpp', 'C++'],
    ['Makefile', 'Makefile'],
    ['Dockerfile', 'Docker'],
    ['x.json', 'JSON'],
    ['x.yaml', 'YAML'],
    ['x.md', 'markdown'],
    ['x.sh', 'Bash'],
    ['x.css', 'CSS'],
    ['x.go.bak', 'Go'],
    ['x.GO', 'plain text'],
  ])
    expect(language(path ?? '', '')).toBe(name ?? '');
  expect(filenameLanguage('unknown.zzzz')).toBeUndefined();
  expect(language('unknown', 'package main\nfunc main(){fmt.Println()}')).toBe('Go');
  expect(language('unknown', '#!/bin/bash\necho hi')).toBe('Bash');
  expect(fenceLanguage('golang')).toBe('Go');
  expect(fenceLanguage('unknown')).toBeUndefined();
});
test('all pinned Chroma filename vectors retain language names and backup matching', () => {
  for (const vector of languageVectors) expect(language(vector.path, '')).toBe(vector.lang);
});

test('scope classes use the fixed theme vocabulary with specific scopes overriding containers', () => {
  expect(classFor(['source.ts', 'string.quoted', 'constant.character.escape.ts'])).toBe('s');
  expect(classFor(['source.python', 'entity.name.function.python'])).toBe('nf');
  expect(classFor(['source.ts', 'variable.other.readwrite.ts'])).toBe('');
  expect(classFor(['source.ts', 'keyword.control.ts'])).toBe('k');
  for (const scope of [
    'invalid.illegal',
    'comment.line',
    'keyword.operator',
    'constant.numeric',
    'entity.name.tag',
  ])
    expect(classes.has(classFor([scope]))).toBe(true);
  expect(() => highlightedText('<i class=k>x</span>')).toThrow();
  expect(() => highlightedText('<i class=unknown>x</i>')).toThrow();
  expect(highlightedText('<i class=k>&lt;x&gt;</i>')).toBe('&lt;x&gt;');
});
test('document windows, source bytes, tabs, final empty lines and width clamp match Go', async () => {
  const doc = new Document('😀\tA\n<&>\n', 'x.unknown', async (s, _, n) => plain(s, n));
  expect(doc.total).toBe(3);
  expect(doc.maxCols).toBe(5);
  expect(visualWidth('😀\tA')).toBe(5);
  expect(doc.raw(1)).toBe('😀\tA');
  expect(doc.raw(3)).toBe('');
  expect(doc.raw(0)).toBe('');
  expect(await doc.lines(-1, 999)).toEqual({ lines: ['😀\tA', '&lt;&amp;&gt;', ''], exact: true });
  expect(await doc.lines(999, 1000)).toEqual({ lines: [], exact: true });
  expect(new Document('x'.repeat(21000), 'x', async (s, _, n) => plain(s, n)).maxCols).toBe(20000);
});
test('multi-chunk requests share window work and refine to the exact background pass', async () => {
  const calls: { lines: number; bytes: number }[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const src = Array.from({ length: 2300 }, (_, i) => String(i)).join('\n');
  const doc = new Document(src, 'x.txt', async (s, _, n) => {
    calls.push({ lines: n, bytes: Buffer.byteLength(s) });
    if (n === 2300) await gate;
    return plain(s, n);
  });
  const [a, b] = await Promise.all([doc.lines(1000, 1020), doc.lines(1000, 1020)]);
  expect(a).toEqual(b);
  expect(a.exact).toBe(false);
  expect(a.lines[0]).toBe('1000');
  expect(calls.filter((c) => c.lines === 1400).length).toBe(1);
  release();
  await doc.settled();
  expect(doc.exact).toBe(true);
  expect((await doc.lines(1000, 1020)).exact).toBe(true);
});
test('oversized windows drop context then fall back without sending giant input to a lexer', async () => {
  let calls = 0;
  const doc = new Document('x'.repeat((2 << 20) + 1) + '\n', 'x.go', async () => {
    calls++;
    return [];
  });
  const result = await doc.lines(0, 2);
  expect(calls).toBe(0);
  expect(result.exact).toBe(false);
  expect(doc.coming).toBe(false);
  expect(result.lines[0]?.length).toBeGreaterThan(windowBytes);
});
test('LRU charges rendered growth and always retains its newest document, including idle trim', () => {
  const cache = new LRU<string>(100);
  cache.put('a|1', 'a', 40);
  cache.put('b|1', 'b', 40);
  cache.get('a|1');
  cache.grow('a|1', 40);
  expect(cache.get('b|1')).toBeUndefined();
  expect(cache.used).toBe(80);
  cache.put('c|1', 'c', 120);
  expect(cache.entries.size).toBe(1);
  cache.trim(1);
  expect(cache.get('c|1')).toBe('c');
  expect(cache.remove('c')).toBe(true);
  expect(cache.used).toBe(0);
});
test('disk cache persists, separates languages and renderer inputs, evicts LRU and invalidates paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'faah-render-disk-'));
  try {
    const path = join(dir, 'cache.sqlite');
    let cache = new RenderDisk(path, 40);
    const a = cache.key('a', 'Go', 1),
      b = cache.key('b', 'Go', 1),
      c = cache.key('c', 'Go', 1);
    expect(cache.key('a', 'Python', 1)).not.toBe(a);
    cache.put(a, '/a', ['1234567890']);
    cache.put(b, '/b', ['1234567890']);
    cache.get(a, '/a');
    cache.put(c, '/c', ['1234567890']);
    expect(cache.get(b, '/b')).toBeUndefined();
    expect(cache.get(a, '/a')).toEqual(['1234567890']);
    cache.close();
    cache = new RenderDisk(path, 40);
    expect(cache.get(a, '/alias')).toEqual(['1234567890']);
    cache.invalidate('/a');
    expect(cache.get(a, '/alias')).toEqual(['1234567890']);
    cache.invalidate('/alias');
    expect(cache.get(a, '/a')).toBeUndefined();
    cache.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('file open shares work, keys nanosecond stats, normalizes CRLF and rejects binary', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'faah-render-open-'));
  const service = new RenderService(new RenderDisk(join(dir, 'cache.sqlite')));
  try {
    const path = join(dir, 'file.txt');
    await writeFile(path, 'a\r\nb\r\n');
    const [a, b] = await Promise.all([
      service.open(path, 'file.txt'),
      service.open(path, 'file.txt'),
    ]);
    expect(a).toBe(b);
    expect(a.raw(1)).toBe('a');
    expect(a.total).toBe(3);
    const info = await stat(path, { bigint: true });
    expect(service.cache.entries.has(`${path}|${info.mtimeNs}|${info.size}`)).toBe(true);
    await writeFile(path, 'changed');
    service.invalidate(path);
    expect(await service.open(path, 'file.txt')).not.toBe(a);
    await writeFile(path, Buffer.from([0, 1]));
    service.invalidate(path);
    expect(service.open(path, 'file.txt')).rejects.toThrow('binary file');
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('idle scavenging ignores metrics and streams, runs once per burst after 15 seconds', () => {
  let count = 0;
  const idle = new IdleScavenger(() => count++);
  try {
    idle.tick(Date.now() + 30000);
    expect(count).toBe(0);
    idle.request('api/meta', null);
    idle.tick(Date.now() + 16000);
    expect(count).toBe(1);
    idle.tick(Date.now() + 40000);
    expect(count).toBe(1);
    idle.request('api/metrics', null);
    idle.tick(Date.now() + 50000);
    expect(count).toBe(1);
  } finally {
    idle.close();
  }
});

test('invalid UTF-8 replaces each bad byte without changing byte-based window accounting', async () => {
  const doc = new Document(
    Buffer.from([0xe2, 0x82, 10, 0xf0, 0x9f, 0x98, 0x80]),
    'unknown',
    async (s, _, n) => plain(s, n),
  );
  expect(doc.raw(1)).toBe('��');
  expect(doc.raw(2)).toBe('😀');
  expect(doc.maxCols).toBe(2);
  expect(doc.initialBytes).toBe(7 + 2 * 32);
  expect((await doc.lines(0, 2)).lines).toEqual(['��', '😀']);
});

// Exercise the embedded assets through the same lazy decoder used by Workers.
test('every mapped grammar loads and preserves source text', async () => {
  const highlight = await engine();
  const source = 'example = "value"\n\nfunction example(x) { return 42; }';
  for (const [language, grammar] of Object.entries(grammars)) {
    if (grammar === 'text') continue;
    const lines = await highlight(source, language, 3);
    expect(lines.map(highlightedText).join('\n')).toBe(source);
  }
}, 30000);

test('deferred cache writes drain at close and invalidation drops queued stale data', async () => {
  const { RenderWrites } = await import('../src/render/writes.ts');
  const dir = await mkdtemp(join(tmpdir(), 'faah-render-write-'));
  const path = join(dir, 'cache.sqlite');
  const disk = new RenderDisk(path);
  const writes = new RenderWrites(path, disk.budget);
  try {
    const stale = disk.key('old', 'Go', 1);
    writes.put(stale, 'a.go', ['old']);
    writes.invalidate('a.go');
    const fresh = disk.key('fresh', 'Go', 1);
    writes.put(fresh, 'a.go', ['fresh']);
    await writes.close();
    expect(disk.get(stale, 'a.go')).toBeUndefined();
    expect(disk.get(fresh, 'a.go')).toEqual(['fresh']);
  } finally {
    disk.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('closing immediately cancels warm-up silently and cannot restart a closed pool', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'faah-render-cancel-'));
  const service = new RenderService(new RenderDisk(join(dir, 'cache.sqlite')));
  const stderr = spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    const warm = service.warm(['main.go', 'app.py', 'index.ts']);
    const close = service.close();
    await expect(warm).resolves.toBeUndefined();
    await close;
    await expect(service.warm(['after.go'])).resolves.toBeUndefined();
    await service.close();
    await Bun.sleep(10);
    expect(stderr).not.toHaveBeenCalled();
    expect(() => service.pool.prepare()).toThrow('render cancelled');
  } finally {
    stderr.mockRestore();
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('shutdown settles a scheduled exact pass and drains L2 writes without logging', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'faah-render-exact-cancel-'));
  const service = new RenderService(new RenderDisk(join(dir, 'cache.sqlite')));
  const stderr = spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    const file = join(dir, 'large.go');
    await writeFile(file, 'package main\n' + '// line\n'.repeat(2200));
    const doc = await service.open(file, 'large.go');
    await doc.lines(0, 10);
    await service.close();
    await expect(doc.settled()).resolves.toBeUndefined();
    service.invalidate(file);
    await Bun.sleep(10);
    expect(stderr).not.toHaveBeenCalled();
  } finally {
    stderr.mockRestore();
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});
