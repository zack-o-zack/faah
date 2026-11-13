import { test } from 'bun:test';
import { fixture } from './fixtures.ts';
import { launchWorkbench, waitReady, type Server } from './launch.ts';
import { capture, type Context } from './harness.ts';
import { query, object, request } from './transport.ts';

test('workbench/offline-lifecycle', async () => {
  const f = await fixture();
  let server: Server | undefined;
  try {
    server = await launchWorkbench(f);
    const c: Context = { f, server };
    await capture(c, 'workbench', 'ping', 'api/wb/ping');
    await capture(c, 'workbench', 'state-empty', 'api/wb/state');
    await capture(c, 'workbench', 'browse', query('api/wb/browse', { path: f.root }));
    await capture(
      c,
      'workbench',
      'browse-hidden',
      query('api/wb/browse', { path: f.root, hidden: 1 }),
    );
    await capture(c, 'workbench', 'complete', query('api/wb/complete', { q: 'ne' }));
    await capture(c, 'workbench', 'complete-empty', 'api/wb/complete?q=');
    await capture(c, 'workbench', 'complete-home', 'api/wb/complete?q=~');
    await capture(c, 'workbench', 'mkdir', 'api/wb/mkdir', {
      method: 'POST',
      json: { path: 'created/deep', base: f.root },
    });
    await capture(c, 'workbench', 'mkdir-conflict', 'api/wb/mkdir', {
      method: 'POST',
      json: { path: 'created/deep', base: f.root },
    });
    await capture(c, 'workbench', 'theme', 'api/settings', {
      method: 'POST',
      json: { 'workbench.colorTheme': 'github-dark' },
    });
    await capture(c, 'workbench', 'theme-extra-rejected', 'api/settings', {
      method: 'POST',
      json: { 'workbench.colorTheme': 'github-dark', 'editor.fontSize': 18 },
    });
    await capture(c, 'workbench', 'settings-get', 'api/settings');
    const opened = await request(server.baseUrl, 'api/wb/open', {
      method: 'POST',
      json: { target: f.root },
    });
    if (
      !object(opened.body) ||
      typeof opened.body.id !== 'string' ||
      typeof opened.body.href !== 'string'
    )
      throw new Error('Invalid workbench open');
    const id = opened.body.id;
    // Stable workspace ids hash the absolute path; replace only this validated id.
    const { golden } = await import('./harness.ts');
    const { normalize } = await import('./normalize.ts');
    await golden(
      'workbench',
      'open',
      normalize(opened, 'api/wb/open', { fixture: f, baseUrl: server.baseUrl, workspaceId: id }),
    );
    const proxy = new URL(opened.body.href, server.baseUrl).href;
    await waitReady(proxy);
    await capture(c, 'workbench', 'proxied-meta', `${opened.body.href}api/meta`, {}, id);
    await capture(
      c,
      'workbench',
      'pin',
      'api/wb/pin',
      { method: 'POST', json: { id, pinned: true } },
      id,
    );
    await capture(c, 'workbench', 'state-running', 'api/wb/state', {}, id);
    await capture(c, 'workbench', 'stop', 'api/wb/stop', { method: 'POST', json: { id } }, id);
    await capture(c, 'workbench', 'state-stopped', 'api/wb/state', {}, id);
    await capture(c, 'workbench', 'remove', 'api/wb/remove', { method: 'POST', json: { id } }, id);
    await capture(c, 'workbench', 'state-removed', 'api/wb/state');
    for (const route of ['api/wb/state', 'api/wb/browse', 'api/wb/complete']) {
      await capture(c, 'workbench', `${route.replaceAll('/', '-')}-host`, route, {
        headers: { Host: 'evil.invalid' },
      });
    }
    for (const route of [
      'api/wb/mkdir',
      'api/wb/open',
      'api/wb/stop',
      'api/wb/pin',
      'api/wb/remove',
      'api/settings',
    ]) {
      const name = route.replaceAll('/', '-');
      await capture(c, 'workbench', `${name}-no-origin`, route, {
        method: 'POST',
        origin: false,
        json: {},
      });
      await capture(c, 'workbench', `${name}-wrong-origin`, route, {
        method: 'POST',
        headers: { Origin: 'http://evil.invalid' },
        json: {},
      });
      await capture(c, 'workbench', `${name}-bad-host`, route, {
        method: 'POST',
        headers: { Host: 'evil.invalid', Origin: 'http://evil.invalid' },
        json: {},
      });
    }
    for (const route of ['api/wb/state', 'api/wb/browse', 'api/wb/complete']) {
      await capture(c, 'workbench', `${route.replaceAll('/', '-')}-post`, route, {
        method: 'POST',
        origin: false,
      });
    }
    for (const route of [
      'api/wb/mkdir',
      'api/wb/open',
      'api/wb/stop',
      'api/wb/pin',
      'api/wb/remove',
    ]) {
      await capture(c, 'workbench', `${route.replaceAll('/', '-')}-get`, route);
    }
  } finally {
    try {
      if (server) await server.stop();
    } finally {
      await f.cleanup();
    }
  }
}, 60000);
