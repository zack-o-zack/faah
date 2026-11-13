import { expect, test } from 'vitest';
import {
  chosenMethod,
  commentPreview,
  commentThreads,
  composerTarget,
  connectedMessage,
  markerCounts,
  mergePill,
  mergeWarnings,
  prState,
  reviewGate,
  rowTarget,
  splitMessage,
} from './logic.js';

const idle = { running: false, inProgress: '', rewritten: false };

test('prState reads merged, closed, draft and open', () => {
  expect(prState({ merged: true, state: 'closed' })).toBe('merged');
  expect(prState({ state: 'closed' })).toBe('closed');
  expect(prState({ state: 'open', draft: true })).toBe('draft');
  expect(prState({ state: 'open' })).toBe('open');
});

test('comment threads group posted replies and drafts by location, root first', () => {
  const threads = commentThreads(
    [
      { id: 2, path: 'b.go', line: 4, inReplyTo: 1, createdAt: '2026-01-02' },
      { id: 1, path: 'b.go', line: 4, createdAt: '2026-01-01' },
      { id: 3, path: 'a.go', line: 9, side: 'LEFT', createdAt: '2026-01-01' },
    ],
    [
      { id: 'd1', path: 'b.go', line: 4, side: 'RIGHT', body: 'nit' },
      { id: 'd2', body: 'loose' },
    ],
  );
  expect(threads.map((thread) => thread.key)).toEqual(['a.go|LEFT:9', 'b.go|RIGHT:4']);
  expect(threads[1].root.id).toBe(1);
  expect(threads[1].existing.map((comment) => comment.id)).toEqual([1, 2]);
  expect(threads[1].drafts).toHaveLength(1);
  expect(
    markerCounts([{ path: 'b.go', line: 4 }], [{ path: 'b.go', line: 4 }]).get('b.go|RIGHT:4'),
  ).toBe(2);
});

test('diff rows and selections map to the side a comment lands on', () => {
  expect(rowTarget({ oldLine: 3 })).toEqual({ side: 'LEFT', line: 3 });
  expect(rowTarget({ oldLine: 3, newLine: 4 })).toEqual({ side: 'RIGHT', line: 4 });
  expect(rowTarget({ at: 5 })).toBe(null);
  expect(composerTarget({ path: 'a.go', l1: 2, l2: 4 })).toEqual({
    path: 'a.go',
    side: 'RIGHT',
    line: 2,
    label: 'a.go:2-4',
  });
  expect(
    composerTarget({ path: 'a.go', side: 'LEFT', l1: 9, l2: 9, delL1: 3, delL2: 3 }).label,
  ).toBe('a.go:3 (base)');
});

test('the checkout state gates verdicts before the forge state does', () => {
  expect(reviewGate({ ...idle, running: true }, 'clean', 'main').all).toMatch(/rebase/);
  expect(reviewGate({ ...idle, inProgress: 'merge' }, 'clean', 'main').all).toMatch(/merge/);
  expect(reviewGate({ ...idle, rewritten: true }, 'clean', 'main').approve).toMatch(/Force-push/);
  expect(reviewGate(idle, 'conflicts', 'main').approveNote).toMatch(/conflicts with main/);
  expect(reviewGate(idle, 'clean', 'main')).toEqual({ all: '', approve: '', approveNote: '' });
});

test('the merge pill names the next step', () => {
  expect(mergePill({ ...idle, rewritten: true }, null, 'main').act).toBe('push');
  expect(mergePill(idle, { state: 'conflicts' }, 'main')).toMatchObject({
    tone: 'err',
    act: 'resolve',
  });
  expect(mergePill(idle, { state: 'clean' }, 'main').text).toBe('Ready to merge');
  expect(mergePill(idle, { state: 'weird' }, 'main')).toBe(null);
  expect(mergePill(idle, null, 'main')).toBe(null);
});

test('merge warnings block on stale or rewritten checkouts and note unpushed commits', () => {
  expect(mergeWarnings({ stale: true }, idle, 'main').block).toMatch(/has not seen/);
  expect(mergeWarnings({ rewritten: true }, idle, 'main').block).toMatch(/Force-push/);
  const info = { unpushed: 2, status: { state: 'unstable', reason: 'CI red' } };
  expect(mergeWarnings(info, idle, 'main')).toEqual({
    block: '',
    notes: [
      'CI red',
      "2 local commits in this checkout aren't pushed to the PR and won't be part of the merge.",
    ],
  });
});

test('merge method and harness message helpers', () => {
  expect(chosenMethod(['merge', 'rebase'], 'rebase')).toBe('rebase');
  expect(chosenMethod(['merge', 'squash'], 'rebase')).toBe('squash');
  expect(chosenMethod([], '')).toBe('merge');
  expect(splitMessage('```\nTitle\n\nBody\n```')).toEqual({ title: 'Title', message: 'Body' });
  expect(splitMessage('"Only a title"')).toEqual({ title: 'Only a title', message: '' });
  expect(commentPreview('> [!NOTE]\n> **Read** <b>this</b>')).toBe('Read this');
  expect(connectedMessage('GitHub', { saved: true, validated: true, writeAccess: false })).toMatch(
    /Read access only/,
  );
});
