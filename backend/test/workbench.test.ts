import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDB } from '../src/store/db.ts';
import { WorkbenchStore } from '../src/workbench/store.ts';
import { Workbench } from '../src/workbench/service.ts';
import { cloneOf, findClone } from '../src/workbench/clones.ts';
import { detectPR } from '../src/cli/target.ts';
import { content } from '../src/http/content.ts';
import { parseSettings } from '../src/settings/json.ts';
test('workbench folder service and clone recognition', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'faah-wb-unit-'));
  const db = openDB(join(temp, 'faah.db'));
  const store = new WorkbenchStore(db);
  const wb = new Workbench({ store, base: '/prefix/', cwd: temp, command: [], features: [] });
  try {
    mkdirSync(join(temp, 'Alpha'));
    mkdirSync(join(temp, 'alpha2'));
    mkdirSync(join(temp, '.hidden'));
    expect(wb.browse('', false).entries.map((e) => e.name)).toEqual(['Alpha', 'alpha2']);
    expect(wb.browse('', true).entries).toHaveLength(3);
    expect(wb.complete('a').entries.map((e) => e.name)).toEqual(['alpha2', 'Alpha']);
    expect(wb.mkdir('nested/deep', '').path).toBe(join(temp, 'nested/deep'));
    expect(() => wb.mkdir('nested/deep', '')).toThrow('already exists');
    expect(Bun.spawnSync(['git', 'init', '-q', join(temp, 'Alpha')]).exitCode).toBe(0);
    Bun.spawnSync([
      'git',
      '-C',
      join(temp, 'Alpha'),
      'remote',
      'add',
      'origin',
      'git@github.com:owner/repo.git',
    ]);
    expect(cloneOf(join(temp, 'Alpha'), 'OWNER/REPO')).toBe(realpathSync(join(temp, 'Alpha')));
    store.rememberClone('owner/repo', join(temp, 'Alpha'));
    expect(findClone(store, 'owner/repo', temp)).toBe(realpathSync(join(temp, 'Alpha')));
  } finally {
    await wb.close();
    db.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
test('forge parsing preserves Go URL patterns', () => {
  expect(detectPR('github.com/owner/repo.git/pull/12/files')).toEqual({
    provider: 'github',
    owner: 'owner',
    repo: 'repo',
    number: 12,
    url: 'github.com/owner/repo.git/pull/12/files',
  });
  expect(detectPR('https://gitlab.example/group/nested/repo/-/merge_requests/2')?.owner).toBe(
    'group/nested',
  );
  expect(detectPR('https://github.com/o/r/pulls/2')).toBeUndefined();
});
test('static ranges and modification validators', async () => {
  const bytes = new TextEncoder().encode('abcdef');
  const partial = content({
    bytes,
    request: new Request('http://localhost/', { headers: { Range: 'bytes=1-3' } }),
    headers: new Headers(),
  });
  expect(partial.status).toBe(206);
  expect(await partial.text()).toBe('bcd');
  expect(
    content({
      bytes,
      request: new Request('http://localhost/', { headers: { Range: 'bytes=100-' } }),
      headers: new Headers(),
    }).status,
  ).toBe(416);
  expect(
    content({
      bytes,
      request: new Request('http://localhost/', {
        headers: { 'If-Modified-Since': 'Fri, 01 Jan 2021 00:00:00 GMT' },
      }),
      headers: new Headers(),
      modified: new Date('2020-01-01'),
    }).status,
  ).toBe(304);
});
test('settings truncated JSON diagnostic matches Go', () => {
  expect(() => parseSettings('{')).toThrow('unexpected end of JSON input');
});
