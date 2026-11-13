import { test, expect } from 'vitest';
import { ago, tildify, fieldKind, breadcrumbs, recentGroups } from './logic.ts';
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
test('pins stay visible beyond recent limit and time labels handle future timestamps', () => {
  const items = Array.from({ length: 20 }, (_, id) => ({ id, pinned: id < 13 }));
  expect(recentGroups(items, false).pinned).toHaveLength(13);
  expect(recentGroups(items, false).recent).toHaveLength(0);
  expect(recentGroups(items, true).recent).toHaveLength(7);
  expect(ago(2000, 1000)).toBe('just now');
});
