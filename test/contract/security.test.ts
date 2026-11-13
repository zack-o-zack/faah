import { suite, mutation, capture } from './harness.ts';
import { query } from './transport.ts';
const s = suite('security');
for (const route of [
  'api/git/stage',
  'api/git/unstage',
  'api/git/hunk',
  'api/git/commit',
  'api/git/push',
  'api/git/pull',
  'api/git/abort',
  'api/settings',
  'api/session',
]) {
  const name = route.replaceAll('/', '-');
  s.case(`${name}-no-origin`, route, { method: 'POST', origin: false, json: {} });
  s.case(`${name}-wrong-origin`, route, {
    method: 'POST',
    headers: { Origin: 'http://evil.invalid' },
    json: {},
  });
  s.case(`${name}-bad-host`, route, {
    method: 'POST',
    headers: { Host: 'evil.invalid', Origin: 'http://evil.invalid' },
    json: {},
  });
  if (!['api/settings', 'api/session'].includes(route)) s.case(`${name}-get`, route);
}
for (const route of [
  'api/file/save',
  'api/fs/new',
  'api/git/sync-state',
  'api/git/log',
  'api/unpushed',
  'api/commitfiles',
  'api/commitdetail',
  'api/settings',
  'api/session',
]) {
  s.case(`${route.replaceAll('/', '-')}-method`, route, {
    method: route.endsWith('save') || route.endsWith('new') ? 'GET' : 'PUT',
  });
}
for (const route of [
  'api/meta',
  'api/tree',
  'api/find',
  'api/file',
  'api/raw',
  'api/close',
  'api/markdown',
  'api/table',
  'api/diff',
  'api/gutter',
  'api/search',
  'api/outline',
  'api/def',
  'api/git/refresh',
]) {
  const params =
    route === 'api/def'
      ? { sym: 'Hello' }
      : {
          path:
            route === 'api/markdown'
              ? 'README.md'
              : route === 'api/table'
                ? 'data.csv'
                : 'history.txt',
        };
  s.case(`${route.replaceAll('/', '-')}-post`, query(route, params), { method: 'POST' });
}
for (const route of [
  'api/file',
  'api/raw',
  'api/markdown',
  'api/table',
  'api/outline',
  'api/close',
]) {
  s.case(`${route.replaceAll('/', '-')}-traversal`, query(route, { path: '../home/outside.txt' }));
  s.case(`${route.replaceAll('/', '-')}-absolute`, (f) =>
    query(route, { path: `${f.temp}/home/outside.txt` }),
  );
}
for (const route of ['api/file/save', 'api/fs/new']) {
  for (const variant of ['no-origin', 'wrong-origin', 'bad-host'])
    mutation('security', `${route.replaceAll('/', '-')}-${variant}`, async (c) => {
      const path = 'security-created.txt';
      const headers =
        variant === 'wrong-origin'
          ? { Origin: 'http://evil.invalid' }
          : variant === 'bad-host'
            ? { Host: 'evil.invalid', Origin: 'http://evil.invalid' }
            : {};
      await capture(c, 'security', `${route.replaceAll('/', '-')}-${variant}`, route, {
        method: 'POST',
        origin: false,
        headers,
        json: { path, content: 'security\n', type: 'file' },
      });
      await capture(
        c,
        'security',
        `${route.replaceAll('/', '-')}-${variant}-file`,
        query('api/file', { path, raw: 1 }),
      );
    });
}
for (const route of ['api/file/save', 'api/fs/new'])
  mutation('security', `${route.replaceAll('/', '-')}-traversal`, async (c) => {
    await capture(c, 'security', `${route.replaceAll('/', '-')}-traversal`, route, {
      method: 'POST',
      json: { path: '../escape.txt', content: 'escape', type: 'file' },
    });
  });

mutation('security', 'non-loopback-ip-host', async (c) => {
  await capture(c, 'security', 'non-loopback-ip-host', 'api/git/stage', {
    method: 'POST',
    headers: { Host: '192.0.2.1:7777', Origin: 'http://192.0.2.1:7777' },
    json: { path: 'unstaged.txt' },
  });
});
mutation('security', 'origin-scheme-unchecked', async (c) => {
  const host = new URL(c.server.baseUrl).host;
  await capture(c, 'security', 'origin-scheme-unchecked', 'api/git/stage', {
    method: 'POST',
    headers: { Origin: `https://${host}` },
    json: { path: 'unstaged.txt' },
  });
});

for (const route of ['api/file', 'api/raw'])
  s.case(
    `${route.replaceAll('/', '-')}-external-symlink`,
    query(route, { path: 'external-link.txt', raw: 1 }),
  );
