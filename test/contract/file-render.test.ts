import { suite } from './harness.ts';
import { query } from './transport.ts';
const s = suite('file-render');
for (const path of [
  'src/hello.go',
  'src/hello.ts',
  'src/hello.py',
  'crlf.txt',
  'tabs.txt',
  'long.txt',
  'binary.bin',
  'pixel.png',
  'deleted.txt',
  'missing.txt',
  'ignored/secret.txt',
  'empty.txt',
  'unicode/你好-😀-é.txt',
  '.hidden',
  'link.txt',
]) {
  const name = path.replaceAll('/', '-').replaceAll('.', '_');
  s.case(`file-${name}`, query('api/file', { path, raw: 1 }));
}
for (const ext of ['go', 'ts', 'py']) {
  for (const start of [0, 990, 1000, 1200])
    s.case(
      `chunk-${ext}-${start}`,
      query('api/file', { path: `src/large.${ext}`, start, count: 20, raw: 1 }),
    );
}
for (const [name, start, count] of [
  ['negative', -3, 2],
  ['beyond', 9999, 4],
  ['zero-count', 0, 0],
  ['negative-count', 0, -1],
  ['bad-numbers', 'abc', 'xyz'],
] satisfies [string, string | number, string | number][]) {
  s.case(`window-${name}`, query('api/file', { path: 'src/hello.go', start, count }));
}
s.case('historical-file', (f) => query('api/file', { path: 'history.txt', ref: f.first, raw: 1 }));
s.case('historical-file-base', (f) =>
  query('api/file', { path: 'history.txt', ref: f.head, base: f.first, raw: 1 }),
);
for (const path of ['crlf.txt', 'pixel.png', 'binary.bin', 'missing.txt', 'unicode/你好-😀-é.txt'])
  s.case(`raw-${path.replaceAll('/', '-')}`, query('api/raw', { path }));
s.case('raw-ref-ignored', (f) => query('api/raw', { path: 'history.txt', ref: f.first }));
s.case('close', query('api/close', { path: 'src/hello.go' }), { method: 'POST' });
for (const [name, path] of [
  ['rich', 'README.md'],
  ['wrong-type', 'tabs.txt'],
  ['too-large', 'ignored/huge.md'],
  ['missing', 'absent.md'],
]) {
  if (name && path) s.case(`markdown-${name}`, query('api/markdown', { path }));
}
for (const path of ['data.csv', 'data.tsv', 'bad.csv', 'empty.csv', 'tabs.txt', 'missing.csv'])
  s.case(`table-${path.replace('.', '-')}`, query('api/table', { path }));
for (const path of [
  'src/hello.go',
  'src/hello.ts',
  'src/hello.py',
  'README.md',
  'empty.txt',
  'missing.txt',
])
  s.case(`outline-${path.replaceAll('/', '-')}`, query('api/outline', { path }));
s.case('definition', query('api/def', { sym: 'Hello', path: 'src/hello.go' }));
s.case('definition-none', query('api/def', { sym: 'MissingSymbol' }));
s.case('definition-empty', 'api/def');
for (const [name, route] of [
  ['file', query('api/file', { path: 'crlf.txt', raw: 1 })],
  ['markdown', query('api/markdown', { path: 'README.md' })],
  ['raw', query('api/raw', { path: 'crlf.txt' })],
] satisfies [string, string][])
  s.case(`${name}-gzip`, route, { headers: { 'Accept-Encoding': 'gzip' } });
for (const ext of ['go', 'ts', 'py'])
  s.run(`whole-chunks-${ext}`, async (c) => {
    const { request, object, array } = await import('./transport.ts');
    const { capture } = await import('./harness.ts');
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { expect } = await import('bun:test');
    const raw: string[] = [];
    for (const start of [0, 1000]) {
      const route = query('api/file', { path: `src/large.${ext}`, start, count: 1000, raw: 1 });
      const reply = await capture(c, 'file-render', `whole-${ext}-${start}`, route);
      if (!object(reply.body) || !array(reply.body.raw)) throw new Error('Missing raw lines');
      for (const line of reply.body.raw) {
        if (typeof line !== 'string') throw new Error('Invalid raw line');
        raw.push(line);
      }
    }
    expect(raw.join('\n')).toBe(await readFile(join(c.f.root, `src/large.${ext}`), 'utf8'));
    const identity = await request(
      c.server.baseUrl,
      query('api/file', { path: `src/large.${ext}`, count: 20 }),
      { stableFile: true },
    );
    const gzip = await request(
      c.server.baseUrl,
      query('api/file', { path: `src/large.${ext}`, count: 20 }),
      { stableFile: true, headers: { 'Accept-Encoding': 'gzip' } },
    );
    expect(gzip.body).toEqual(identity.body);
  });
