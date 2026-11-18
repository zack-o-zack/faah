import { test, expect } from 'vitest';
import { ago, tildify, parentFolder, fieldKind, breadcrumbs, recentSections } from './logic.ts';
test.each([
  ['/home/me/Projects/config/', '/home/me', '/', '~/Projects'],
  ['/home/me/Projects/config', '/home/me', '/', '~/Projects'],
  ['/home/me/config/', '/home/me', '/', '~'],
  ['/home/men/config/', '/home/me', '/', '/home/men'],
  ['/config/', '/home/me', '/', '/'],
  ['/', '/home/me', '/', '/'],
  ['C:\\Users\\me\\Projects\\config\\', 'C:\\Users\\me', '\\', '~\\Projects'],
  ['C:\\Users\\me\\config\\', 'C:\\Users\\me', '\\', '~'],
  ['C:\\config\\', 'C:\\Users\\me', '\\', 'C:\\'],
  ['C:\\', 'C:\\Users\\me', '\\', 'C:\\'],
])(
  'parentFolder(%s) shows the parent without repeating the folder',
  (path, home, sep, expected) => {
    expect(parentFolder(path, home, sep)).toBe(expected);
  },
);
test('recognises folders and supported PR links', () => {
  expect(fieldKind(' ')).toBe('empty');
  expect(fieldKind('~/code')).toBe('dir');
  expect(fieldKind('https://host/org/repo/pull/5')).toBe('pr');
  expect(fieldKind('https://host/repo')).toBe('link');
});
test('home matching respects folder boundaries and breadcrumbs keep full paths', () => {
  expect(tildify('/home/me/code', '/home/me')).toBe('~/code');
  expect(tildify('/home/men', '/home/me')).toBe('/home/men');
  expect(breadcrumbs('/home/me/code', '/home/me')).toEqual([
    { name: '~', path: '/home/me' },
    { name: 'code', path: '/home/me/code' },
  ]);
});
test('time labels handle future timestamps', () => {
  expect(ago(2000, 1000)).toBe('just now');
});

test('recent sections split kinds and sort pins then newest without changing the input', () => {
  const folder = { kind: 'dir', lastOpened: 40 };
  const pr = { kind: 'pr', lastOpened: 30 };
  const pinnedFolder = { kind: 'dir', pinned: true, lastOpened: 10 };
  const pinnedPr = { kind: 'pr', pinned: true, lastOpened: 5 };
  const newerPin = { kind: 'pr', pinned: true, lastOpened: 20 };
  const olderPr = { kind: 'pr', lastOpened: 15 };
  const unknownKind = { lastOpened: 1 };
  const items = [folder, pinnedPr, unknownKind, pr, pinnedFolder, olderPr, newerPin];
  const original = [...items];
  expect(recentSections(items, false)).toEqual({
    prs: [newerPin, pinnedPr, pr, olderPr],
    folders: [pinnedFolder, folder, unknownKind],
    total: 7,
  });
  expect(items).toEqual(original);
});

test('the 12-row cap is shared across kinds, keeping old pins and the newest unpinned items', () => {
  const items = Array.from({ length: 20 }, (_, id) => ({
    id,
    kind: id % 2 ? 'pr' : 'dir',
    pinned: id < 2,
    lastOpened: id,
  }));
  const limited = recentSections(items, false);
  expect(limited.total).toBe(20);
  expect(limited.prs.map((item) => item.id)).toEqual([1, 19, 17, 15, 13, 11]);
  expect(limited.folders.map((item) => item.id)).toEqual([0, 18, 16, 14, 12, 10]);
  const all = recentSections(items, true);
  expect(all.prs).toHaveLength(10);
  expect(all.folders).toHaveLength(10);
  expect(all.total).toBe(20);
});

test('all pins stay visible even when there are more than 12', () => {
  const items = Array.from({ length: 20 }, (_, id) => ({
    id,
    kind: 'dir',
    pinned: id < 13,
    lastOpened: id,
  }));
  const limited = recentSections(items, false);
  expect(limited.folders).toHaveLength(13);
  expect(limited.folders.every((item) => item.pinned)).toBe(true);
  expect(recentSections(items, true).folders).toHaveLength(20);
});

test('recent sections support empty lists and empty groups', () => {
  expect(recentSections([], false)).toEqual({ prs: [], folders: [], total: 0 });
  const folder = { kind: 'dir' };
  const pr = { kind: 'pr' };
  expect(recentSections([folder], false)).toEqual({ prs: [], folders: [folder], total: 1 });
  expect(recentSections([pr], true)).toEqual({ prs: [pr], folders: [], total: 1 });
});
