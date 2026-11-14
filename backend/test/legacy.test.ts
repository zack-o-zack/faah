import { test, expect } from 'bun:test';
import { LegacyConsistency } from '../src/legacy/consistency.ts';

const treeWriters = [
  'api/agent/edit',
  'api/agent/batch',
  'api/agent/job',
  'api/agent/cancel',
  'api/threads/send',
  'api/threads/cancel',
  'api/threads/revert',
  'api/review-workflow/run',
  'api/review-workflow/status',
  'api/review-workflow/stop',
];

test('proxied writers refresh native Git and rebuild the index', async () => {
  const touched: string[] = [];
  let refreshes = 0,
    rebuilds = 0,
    metas = 0;
  const consistency = new LegacyConsistency({
    refreshGit: async () => {
      refreshes++;
    },
    rebuildIndex: async () => {
      rebuilds++;
    },
    touch: async (path) => {
      touched.push(path);
    },
    refreshMeta: async () => {
      metas++;
    },
  });
  const get = new Request('http://localhost/');
  const post = new Request('http://localhost/', { method: 'POST' });
  for (const route of ['api/git/commit-message', 'api/git/sync-agent'])
    await consistency.after(route, post, Response.json({ error: 'failed' }, { status: 502 }));
  expect(refreshes).toBe(2);
  expect(rebuilds).toBe(1);
  for (const route of treeWriters)
    await consistency.after(route, post, Response.json({ ok: true }));
  expect(rebuilds).toBe(1 + treeWriters.length);
  await consistency.after('api/review-workflow/config', post, Response.json({}));
  expect(touched).toEqual(['.faah/workflows.json']);
  await consistency.after('api/review-workflow/config', get, Response.json({}));
  expect(touched).toHaveLength(1);
  const before = refreshes;
  await consistency.after('api/threads/revert', post, Response.json({}, { status: 404 }));
  expect(refreshes).toBe(before + 1);
  await consistency.after('api/lsp/start', post, Response.json({}));
  expect(metas).toBe(8);
});
