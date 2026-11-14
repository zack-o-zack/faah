import { test, expect } from 'bun:test';
import { find, newItem, isBoundary, rank, score } from '../src/fuzzy/score.ts';
import { FuzzyPool } from '../src/fuzzy/pool.ts';
import { generateItems, fuzzyPaths } from '../bench/vectors.ts';

test('Go fuzzy ranking, case, empty queries and top-K', () => {
  const items = fuzzyPaths.slice(0, 6).map((p) => newItem(p));
  const results = find(items, 'httpserver', 10);
  expect(results[0]?.path).toBe('httpserver.go');
  for (const result of results) {
    const bytes = Buffer.from(result.path.toLowerCase());
    expect(Buffer.from((result.pos ?? []).map((i) => bytes[i] ?? 0)).toString()).toBe('httpserver');
  }
  expect(find(items, 'zzqq', 10)).toEqual([]);
  expect(find(items, 'appjs', 10)[0]?.path).toBe('web/app.js');
  expect(
    find(
      ['src/HTTPServer.go', 'src/httpserver.go'].map((p) => newItem(p)),
      'HTTPServer',
      10,
    )[0]?.path,
  ).toBe('src/HTTPServer.go');
  expect(
    find(
      ['a.go', 'b.go', 'c.go'].map((p) => newItem(p)),
      '',
      2,
    ).map((r) => r.path),
  ).toEqual(['a.go', 'b.go']);
  expect(find(items, '  http server  ', 10)).toEqual(results);
  expect(find([], 'test', 10)).toEqual([]);
  const servers = [
    'a/b/c/server.go',
    'server.go',
    'src/server.go',
    'pkg/net/server.go',
    'cmd/server/server.go',
    'internal/server.go',
    'vendor/server.go',
  ].map((p) => newItem(p));
  expect(find(servers, 'server', 3)[0]?.path).toBe('server.go');
  expect(find(servers, 'server', 3)).toEqual(find(servers, 'server', 0).slice(0, 3));
  for (const c of '/_-. @') expect(isBoundary(c.charCodeAt(0))).toBe(true);
  for (const c of 'aZ0!:') expect(isBoundary(c.charCodeAt(0))).toBe(false);
  expect(
    score({ item: newItem('fooBarBaz.go'), query: Buffer.from('bb'), original: Buffer.from('bb') })
      ?.score,
  ).toBeGreaterThan(0);
  const tied = find(
    ['z.go', 'a.go'].map((p) => newItem(p)),
    'go',
    10,
  );
  expect(tied.map((r) => r.path)).toEqual(['a.go', 'z.go']);
  expect(
    rank(
      { path: 'z.go', name: 'z.go', pos: [], score: 10 },
      { path: 'a.go', name: 'a.go', pos: [], score: 10 },
    ),
  ).toBeGreaterThan(0);
});

test('fuzzy positions use UTF-8 bytes, including multi-byte query bytes', () => {
  const [result] = find([newItem('目录/你好.ts')], '你好', 10);
  expect(result?.pos).toEqual([7, 8, 9, 10, 11, 12]);
  const item = newItem('İ/Foo.go');
  expect(item.nameStart).toBe(3);
  expect(item.lower).toBe('i/foo.go');
});

test('persistent sharded pool agrees with Go top-K merge and survives updates', async () => {
  const pool = new FuzzyPool();
  try {
    const items = generateItems(10000);
    await pool.set(items);
    expect(pool.workerCount).toBeGreaterThan(0);
    for (const query of ['handler', 'srvutil', 'in', 'server', 'zzqq', ''])
      expect(await pool.find(query, 50)).toEqual(find(items, query, 50));
    await pool.set([...items, newItem('handler')]);
    expect((await pool.find('handler', 1))[0]?.path).toBe('handler');
    await pool.set([newItem('one.go')]);
    expect(pool.workerCount).toBe(0);
    expect((await pool.find('', 50)).map((r) => r.path)).toEqual(['one.go']);
  } finally {
    pool.close();
  }
});
