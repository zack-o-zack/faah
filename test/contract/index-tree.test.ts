import { suite } from './harness.ts';
import { query } from './transport.ts';
const s = suite('index-tree');
s.case('meta', 'api/meta');
s.case('metrics', 'api/metrics');
for (const [name, params] of [
  ['root', {}],
  ['nested', { dir: 'nested' }],
  ['ignored', { dir: 'ignored' }],
  ['missing', { dir: 'absent' }],
  ['compact-all', { compact: 'all' }],
  ['compact-changed', { compact: 'changed' }],
  ['compact-yours', { compact: 'yours' }],
  ['nested-compact', { dir: 'nested', compact: 'all' }],
] satisfies [string, Record<string, string | number>][])
  s.case(`tree-${name}`, query('api/tree', params));
for (const [name, q, limit] of [
  ['empty', '', 100],
  ['subsequence', 'hlg', 100],
  ['unicode', '你好', 100],
  ['emoji', '😀', 100],
  ['combining', 'é', 100],
  ['none', 'impossible-name-xyz', 100],
  ['one', 'src', 1],
  ['zero', 'src', 0],
  ['negative', 'src', -1],
  ['above-cap', 'src', 501],
] satisfies [string, string, number][])
  s.case(`find-${name}`, query('api/find', { q, limit }));
s.case('reindex', 'api/reindex', { method: 'POST' });
