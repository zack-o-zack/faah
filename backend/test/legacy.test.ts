import { test, expect } from 'bun:test';
import { LegacyNavigation, fileMutations } from '../src/legacy/navigation.ts';

test('proxied writers refresh native Git without requesting legacy status or streams', async () => {
  const requests: string[] = [],
    touched: string[] = [];
  let refreshes = 0,
    rebuilds = 0;
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      requests.push(new URL(request.url).pathname);
      return Response.json({ ready: true });
    },
  });
  const legacy = new LegacyNavigation({
    origin: server.url.origin,
    base: '/',
    refresh: async () => {
      refreshes++;
    },
    rebuild: async () => {
      rebuilds++;
    },
    touch: async (path) => {
      touched.push(path);
    },
  });
  try {
    for (const route of ['api/git/commit-message', 'api/git/sync-agent']) {
      await legacy.after({ route, response: Response.json({ error: 'failed' }, { status: 502 }) });
    }
    expect(refreshes).toBe(2);
    expect(rebuilds).toBe(1);
    for (const route of fileMutations)
      await legacy.after({ route, response: Response.json({ ok: true }) });
    expect(rebuilds).toBe(1 + fileMutations.size);
    for (const route of ['api/file/save', 'api/fs/new'])
      await legacy.after({ route, path: 'sub/new.go', response: Response.json({ ok: true }) });
    expect(touched).toEqual(['sub/new.go', 'sub/new.go']);
    await legacy.after({
      route: 'api/review-workflow/config',
      method: 'POST',
      response: Response.json({}),
    });
    expect(touched.at(-1)).toBe('.faah/workflows.json');
    const before = refreshes;
    await legacy.after({
      route: 'api/threads/revert',
      response: Response.json({}, { status: 404 }),
    });
    expect(refreshes).toBe(before + 1);
    expect(requests.every((path) => path === '/api/meta')).toBe(true);
  } finally {
    await legacy.close();
    await server.stop(true);
  }
});
