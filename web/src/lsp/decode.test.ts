import { expect, test } from 'vitest';
import { decodeCalls, decodeServers, decodeSetup, decodeNavigation } from './decode.ts';
test('decodes server status, setup, navigation and opaque call items', () => {
  expect(
    decodeServers({ servers: [{ name: 'ts', installed: true, state: 'ready' }] }).servers[0]?.name,
  ).toBe('ts');
  expect(decodeSetup({ enabled: true, servers: [{ name: 'ts', options: [] }] }).enabled).toBe(true);
  expect(
    decodeCalls({ nodes: [{ name: 'f', path: 'a', line: 1, item: '{}', sites: [2] }] }).nodes[0]
      ?.item,
  ).toBe('{}');
  expect(() => decodeNavigation({ hits: [{ line: '1' }] })).toThrow();
});
