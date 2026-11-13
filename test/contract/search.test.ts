import { suite } from './harness.ts';
import { query } from './transport.ts';
const s = suite('search');
const cases: [string, Record<string, string | number>][] = [
  ['literal', { q: 'needle' }],
  ['regex', { q: 'func.*Hello', re: 1 }],
  ['case-sensitive', { q: 'ASCII', case: 1 }],
  ['case-fold', { q: 'ascii' }],
  ['word', { q: 'needle', word: 1 }],
  ['glob', { q: 'needle', glob: 'src/*.go' }],
  ['ignored-glob', { q: 'needle', glob: 'ignored/secret.txt' }],
  ['unicode', { q: '你好' }],
  ['unicode-literal-fold', { q: 'k', glob: 'unicode/*' }],
  ['unicode-regex-fold', { q: 'k|s|é', re: 1, glob: 'unicode/*' }],
  ['none', { q: 'no-match-xyz' }],
  ['empty', { q: '' }],
  ['invalid-regex', { q: '[', re: 1 }],
  ['per-file-cap', { q: 'capneedle' }],
  ['regex-word', { q: 'Hello', re: 1, word: 1 }],
];
for (const [name, params] of cases) s.case(name, query('api/search', params));

// Exactly 200 matching files freezes the public file-count boundary without
// depending on which parallel worker wins when more than 200 files match.
const { mutation, capture } = await import('./harness.ts');
mutation('search', 'file-cap-boundary', async (c) => {
  for (let i = 0; i < 200; i++)
    await c.f.write(`file-cap/${String(i).padStart(3, '0')}.txt`, 'filecapneedle\n');
  const { request } = await import('./transport.ts');
  await request(c.server.baseUrl, 'api/reindex');
  await capture(c, 'search', 'file-cap-boundary', query('api/search', { q: 'filecapneedle' }));
});
