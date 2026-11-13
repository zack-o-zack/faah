import { expect, test } from 'vitest';
import { documentGitPlan } from './document-logic.js';

test('clean worktree closes only clean live diff tabs outside PR review', () => {
  const tabs = [
    { path: 'live', diffMode: 'split' },
    { path: 'dirty', diffMode: 'split', dirty: true },
    { path: 'commit', diffMode: 'split', diffRef: 'abc' },
    { path: 'source', diffAvailable: true },
  ];
  expect(documentGitPlan(tabs, { statuses: {} }, false)).toEqual({
    close: [0],
    patch: [
      { path: 'dirty', diffAvailable: false },
      { path: 'source', diffAvailable: false },
    ],
    reload: false,
  });
  expect(documentGitPlan(tabs, { statuses: {} }, true).close).toEqual([]);
  expect(documentGitPlan(tabs, { statuses: { live: 'M' } }, false).reload).toBe(true);
});
