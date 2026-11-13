import { suite, mutation, capture } from './harness.ts';
const s = suite('settings-session');
s.case('settings-get', 'api/settings');
s.case('session-get', 'api/session');
for (const [name, body] of [
  ['map', { 'editor.fontSize': 17, 'unknown.contract': { nested: true } }],
  ['raw', { raw: '{"editor.fontSize": 19, "unknown.contract": [1, null]}' }],
] satisfies [string, unknown][])
  mutation('settings-session', `settings-${name}`, async (c) => {
    await capture(c, 'settings-session', `settings-${name}`, 'api/settings', {
      method: 'POST',
      json: body,
    });
    await capture(c, 'settings-session', `settings-${name}-reread`, 'api/settings');
  });
mutation('settings-session', 'settings-query', async (c) => {
  await capture(c, 'settings-session', 'settings-query', 'api/settings?editor.fontSize=18', {
    method: 'POST',
  });
});
mutation('settings-session', 'invalid-json', async (c) => {
  await capture(c, 'settings-session', 'settings-invalid', 'api/settings', {
    method: 'POST',
    text: '{',
  });
  await capture(c, 'settings-session', 'settings-invalid-raw', 'api/settings', {
    method: 'POST',
    json: { raw: '{' },
  });
  await capture(c, 'settings-session', 'session-invalid', 'api/session', {
    method: 'POST',
    text: '{',
  });
});
mutation('settings-session', 'session-save', async (c) => {
  await capture(c, 'settings-session', 'session-save', 'api/session', {
    method: 'POST',
    json: {
      tabs: [{ path: 'history.txt' }, { path: 'src/hello.go', ref: c.f.first }],
      active: 1,
      openDirs: ['src', 'nested'],
    },
  });
  await capture(c, 'settings-session', 'session-reread', 'api/session');
  await capture(c, 'settings-session', 'session-partial', 'api/session', {
    method: 'POST',
    json: { active: 0 },
  });
  // Persistence survives a workspace process restart with the same isolated state.
  await c.server.stop();
  const { launch } = await import('./launch.ts');
  c.server = await launch(c.f);
  await capture(c, 'settings-session', 'session-restart', 'api/session');
});
