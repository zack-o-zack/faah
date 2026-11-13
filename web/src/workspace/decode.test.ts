import { expect, test } from 'vitest';
import {
  decodeTree,
  decodeGitSnapshot,
  decodeMeta,
  decodeMetrics,
  decodeNewItem,
  decodeReindex,
} from './decode.ts';
test('workspace boundaries decode the Go tree, snapshot and metrics fields', () => {
  expect(
    decodeTree({ children: [{ name: 'src', path: 'src', dir: true, size: 0 }] }).children[0]?.dir,
  ).toBe(true);
  expect(
    decodeGitSnapshot({
      git: true,
      statuses: { 'one.go': 'M' },
      staged: { 'one.go': true },
      ahead: 2,
    }).ahead,
  ).toBe(2);
  expect(
    decodeMetrics({
      rssBytes: 1024,
      cpuUsage: 1.5,
      goroutines: 7,
      lspEnabled: true,
      lspMemBytes: 2048,
    }).lspMemBytes,
  ).toBe(2048);
  expect(() => decodeTree({ children: [{ name: 42 }] })).toThrow('text');
  expect(() => decodeGitSnapshot({ statuses: { file: 5 } })).toThrow('text');
  expect(() => decodeMetrics({ rssBytes: '1024' })).toThrow('number');
});
test('metadata retains feature-owned payloads while checking workspace fields', () => {
  const result = decodeMeta({
    root: '/repo',
    name: 'repo',
    pr: { number: 7, files: { 'one.go': 'M' } },
    agents: [{ name: 'agent' }],
  });
  expect(result.pr).toMatchObject({ number: 7, files: { 'one.go': 'M' } });
  expect(result.agents).toEqual([{ name: 'agent' }]);
  expect(() => decodeMeta({ git: 'yes' })).toThrow('boolean');
  expect(decodeNewItem({ ok: true, path: 'new.go', type: 'file' })).toEqual({ path: 'new.go' });
  expect(decodeReindex({ files: 20, indexMs: 10, gitChanges: 1, gitFiles: ['new.go'] })).toEqual({
    files: 20,
    indexMs: 10,
    gitChanges: 1,
    gitFiles: ['new.go'],
  });
});
