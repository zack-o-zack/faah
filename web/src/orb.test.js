import { test, expect } from 'vitest';
import { orbStart, orbFromThread, orbFromStep, orbFromSummary, orbView, orbSnippet } from './orb.js';

const thread = (turn) => ({ id: 't1', turns: [{ id: 1, ...turn }] });

test('orb shows the latest step and notes while an explanation runs', () => {
  let m = orbStart();
  expect(orbView(m)).toMatchObject({ text: 'Explaining', announce: 'Explaining', busy: true });
  m = orbFromThread(m, thread({ running: true, tools: ['Read main.go'], notes: [{}, {}] }));
  expect(m.id).toBe('t1');
  expect(orbView(m).text).toBe('Explaining · Read main.go · 2 notes');
  m = orbFromStep(m, 'Search add');
  expect(orbView(m).text).toBe('Explaining · Search add · 2 notes');
  expect(orbView(m).label).toBe('Explaining · Search add · 2 notes. Open the explanation');
});

test('orb reports the outcome from the final snapshot', () => {
  const done = orbFromThread(orbStart(), thread({ running: false, tools: ['Read a.go'], notes: [{}], walkthroughs: [{ steps: [] }] }));
  expect(orbView(done)).toMatchObject({ text: 'Explained · 1 note · walkthrough', busy: false });
  const failed = orbFromThread(orbStart(), thread({ running: false, error: 'agent exited' }));
  expect(orbView(failed).text).toBe('Explanation failed');
  expect(orbView(failed).label).toBe('Explanation failed: agent exited. Open the explanation');
});

test('steps after the end are ignored', () => {
  const done = orbFromThread(orbStart(), thread({ running: false }));
  expect(orbFromStep(done, 'Read late.go')).toBe(done);
});

test('the list summary ends a running orb', () => {
  const running = orbFromThread(orbStart(), thread({ running: true }));
  expect(orbFromSummary(running, { running: true })).toBe(running);
  expect(orbFromSummary(running, { running: false }).phase).toBe('done');
  expect(orbFromSummary(running, { running: false, failed: true }).phase).toBe('failed');
});

test('a failure before the thread exists has no link to open', () => {
  const m = { ...orbStart(), phase: /** @type {const} */ ('failed'), error: 'no agent\nstack trace' };
  expect(orbView(m).label).toBe('Explanation failed: no agent');
});

test('a finished orb shows the last paragraph of the answer as plain text', () => {
  expect(orbSnippet('First part.\n\n```go\nx := 1\n```\n\n- **add** sums [two ints](main.go:4)\n  and returns `a + b`.')).toBe('add sums two ints and returns a + b.');
  expect(orbSnippet('')).toBe('');
  const done = orbFromThread(orbStart(), thread({ running: false, reply: 'Intro.\n\nIt sums two numbers.' }));
  expect(orbView(done)).toMatchObject({ snippet: 'It sums two numbers.', shown: '' });
  const noted = orbFromThread(orbStart(), thread({ running: false, reply: 'It sums.', notes: [{}, {}] }));
  expect(orbView(noted)).toMatchObject({ shown: '2 notes', label: 'Explained · 2 notes. Open the explanation' });
  const running = orbFromThread(orbStart(), thread({ running: true, reply: 'Partial' }));
  expect(orbView(running).snippet).toBe('');
});
