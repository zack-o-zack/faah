import { expect, test } from 'vitest';
import { decodeCommitFiles, decodeSync, decodeGutter, decodeUnpushed } from './decode.ts';
test('decodes Git handler snapshots and rejects invalid counts', () => {
  expect(
    decodeCommitFiles({ files: [{ path: 'a', status: 'M', add: 2, del: 1 }] }).files[0]?.binary,
  ).toBe(false);
  expect(decodeSync({ ahead: 2, behind: 1, rewritten: true }).rewritten).toBe(true);
  expect(decodeGutter({ available: true, modified: [2] }).modified).toEqual([2]);
  expect(decodeUnpushed({ commits: null }).commits).toEqual([]);
  expect(() => decodeGutter({ modified: ['2'] })).toThrow();
});
