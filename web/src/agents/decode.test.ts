import { expect, test } from 'vitest';
import { decodeAgents, decodeModels } from './decode.ts';
import { decodeAgentJob } from './job-decode.ts';
test('decodes harness and numeric job responses without accepting malformed IDs', () => {
  expect(
    decodeAgents({
      harnesses: [{ name: 'test', cmd: 'test', installed: true, models: ['a'] }],
      selected: 'test',
    }).harnesses[0]?.models,
  ).toEqual(['a']);
  expect(
    decodeAgentJob({ id: 2, items: [{ path: 'a', l1: 1, l2: 2, instruction: 'fix' }] }).items[0]
      ?.instruction,
  ).toBe('fix');
  expect(() => decodeAgentJob({ id: '2' })).toThrow();
  expect(() => decodeModels({ models: [1] })).toThrow();
});
