import { expect, test } from 'vitest';
import { decodeWorkbench, decodeDirectory, decodeOpen, decodeMkdir } from './decode.ts';
import { holdingUpdate } from '../holding/logic.ts';
test('decodes workbench state and directory responses and both open outcomes', () => {
  expect(
    decodeWorkbench({
      cwd: '/repo',
      items: [{ id: 'one', href: '/one/', state: 'starting', progress: 'Clone' }],
    }).items?.[0]?.progress,
  ).toBe('Clone');
  expect(
    decodeDirectory({
      path: '/repo',
      parent: '/',
      entries: [{ name: 'child', path: '/repo/child', git: true }],
    }).entries[0]?.git,
  ).toBe(true);
  expect(decodeOpen({ needClone: true, repo: 'o/r', managed: '~/r' })).toEqual({
    needClone: true,
    repo: 'o/r',
    managed: '~/r',
  });
  expect(decodeOpen({ id: 'one', href: '/one/' })).toMatchObject({
    needClone: false,
    href: '/one/',
  });
  expect(decodeMkdir({ path: '/new' }).path).toBe('/new');
  expect(holdingUpdate([{ href: '/one/', state: 'starting', progress: 'Clone' }], '/one/')).toEqual(
    { reload: false, progress: 'Clone' },
  );
  expect(() => decodeDirectory({ entries: [{ git: 'yes' }] })).toThrow();
});
