import type { OrbModel, OrbThread } from './orb-model.ts';
import { test, expect } from 'vitest';
import {
  orbStart,
  orbFromThread,
  orbFromStep,
  orbFromSummary,
  orbView,
  orbSnippet,
  orbUpdate,
  walkStart,
  walkMove,
  walkStop,
  walkStep,
} from './orb-model.ts';

const thread = (turn: Omit<NonNullable<OrbThread['turns']>[number], 'id'>) => ({
  id: 't1',
  turns: [{ id: 1, ...turn }],
});

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
  const done = orbFromThread(
    orbStart(),
    thread({
      running: false,
      tools: ['Read a.go'],
      notes: [{}],
      walkthroughs: [{ title: 'Flow', steps: [] }],
    }),
  );
  expect(orbView(done)).toMatchObject({
    text: 'Explained · 1 note',
    label: 'Explained · 1 note · 1 walkthrough. Open the explanation',
    busy: false,
  });
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
  const m: OrbModel = {
    ...orbStart(),
    phase: 'failed',
    error: 'no agent\nstack trace',
  };
  expect(orbView(m).label).toBe('Explanation failed: no agent');
});

test('a finished orb shows the last paragraph of the answer as plain text', () => {
  expect(
    orbSnippet(
      'First part.\n\n```go\nx := 1\n```\n\n- **add** sums [two ints](main.go:4)\n  and returns `a + b`.',
    ),
  ).toBe('add sums two ints and returns a + b.');
  expect(orbSnippet('')).toBe('');
  const done = orbFromThread(
    orbStart(),
    thread({ running: false, reply: 'Intro.\n\nIt sums two numbers.' }),
  );
  expect(orbView(done)).toMatchObject({ snippet: 'It sums two numbers.', shown: '' });
  const noted = orbFromThread(
    orbStart(),
    thread({ running: false, reply: 'It sums.', notes: [{}, {}] }),
  );
  expect(orbView(noted)).toMatchObject({
    shown: '2 notes',
    label: 'Explained · 2 notes. Open the explanation',
  });
  const running = orbFromThread(orbStart(), thread({ running: true, reply: 'Partial' }));
  expect(orbView(running).snippet).toBe('');
});

test('a reopened bubble stays on its selected turn as later turns arrive', () => {
  const snapshot = {
    id: 't',
    turns: [
      { id: 1, reply: 'First', notes: [{}] },
      { id: 2, reply: 'Second', notes: [{}, {}] },
    ],
  };
  const selected = orbFromThread({ ...orbStart(), turn: 1 }, snapshot);
  expect(selected).toMatchObject({ id: 't', turn: 1, reply: 'First', notes: 1 });
  expect(orbFromThread(selected, snapshot)).toEqual(selected);
  expect(orbFromThread(selected, { id: 't', turns: [{ id: 2 }] })).toBe(selected);
});

test('walkthrough helpers clamp movement and bubble replacement resets the position', () => {
  const model = {
    ...orbStart(),
    id: 'first',
    turn: 1,
    walkthroughs: [
      {
        title: 'Flow',
        steps: [
          { path: 'a.go', l1: 1, l2: 2, title: 'First', body: '', text: '' },
          { path: 'b.go', l1: 2, l2: 3, title: 'Second', body: '', text: '' },
        ],
      },
    ],
  };
  expect(walkStart(null)).toBeNull();
  expect(walkStart(model, 1)).toBeNull();
  const start = walkStart(model);
  expect(start).toEqual({ index: 0, step: 0, surface: 'source' });
  expect(walkMove(model, start, -1)).toEqual(start);
  const end = walkMove(model, start, 1);
  expect(end).toEqual({ index: 0, step: 1, surface: 'source' });
  expect(walkMove(model, end, 1)).toEqual(end);
  expect(walkMove(model, null, 1)).toEqual(start);
  expect(walkStep({ model, walk: end, compact: false })).toMatchObject({
    path: 'b.go',
    n: 2,
    of: 2,
  });
  expect(orbUpdate({ model, walk: end, compact: false }, { ...model })).toMatchObject({
    walk: end,
  });
  expect(orbUpdate({ model, walk: end, compact: false }, { ...model, turn: 2 }).walk).toBeNull();
  expect(
    orbUpdate({ model, walk: end, compact: false }, { ...model, id: 'other' }).walk,
  ).toBeNull();
  expect(orbUpdate({ model, walk: end, compact: false }, null).walk).toBeNull();
  expect(walkStop()).toBeNull();
  expect(orbView(model).label).toContain('walkthrough');
});
