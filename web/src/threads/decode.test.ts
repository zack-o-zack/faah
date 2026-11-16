import { expect, test } from 'vitest';
import { decodeThread, decodeThreadEvent, decodeExplain } from './decode.ts';
test('preserves checked citations and the Go note and walkthrough field names', () => {
  const thread = decodeThread({
    id: 't',
    explainReq: { path: 'a', l1: 1, l2: 2, symbol: 'x', text: 'ignored old content' },
    turns: [
      {
        id: 1,
        refs: { 'a:1': { line: 1 } },
        notes: [
          {
            kind: 'block',
            path: 'a',
            l1: 1,
            l2: 2,
            summary: 'summary',
            detail: 'detail',
            text: 'x',
          },
        ],
        walkthroughs: [
          {
            title: 'walk',
            steps: [{ path: 'a', l1: 3, l2: 4, title: 'step', body: 'body', text: 'x' }],
          },
        ],
      },
    ],
  });
  expect(thread.turns[0]?.notes?.[0]?.summary).toBe('summary');
  expect(thread.turns[0]?.walkthroughs?.[0]?.steps[0]?.l1).toBe(3);
  expect(thread.explainReq).toMatchObject({ path: 'a', l1: 1, l2: 2, symbol: 'x' });
  expect(thread.explainReq).not.toHaveProperty('text');
  expect(
    decodeThread({ id: 'file', explainReq: { path: 'a.go', file: true }, turns: [] }).explainReq,
  ).toEqual({ path: 'a.go', file: true });
  expect(decodeThreadEvent({ id: 't', data: { turn: 1, text: 'tail' } }).data.text).toBe('tail');
  expect(() => decodeExplain({ thread: { turns: [{ id: 'bad' }] } })).toThrow();
});
