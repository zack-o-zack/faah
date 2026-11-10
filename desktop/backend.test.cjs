const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { startBackend } = require('./backend.cjs');

const executable = path.join(__dirname, 'bin', process.platform === 'win32' ? 'faah.exe' : 'faah');

test('missing backend reports a launch error and can still be stopped', async () => {
  const backend = startBackend(path.join(os.tmpdir(), 'faah-missing-executable', 'faah'));
  await assert.rejects(backend.ready, { code: 'ENOENT' });
  await backend.stop();
});

test('desktop backend owns its port, serves workspaces and streams, and stops on stdin EOF', {
  skip: !fs.existsSync(executable), timeout: 30_000,
}, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'faah-desktop-test-'));
  const workspace = path.join(temp, 'repo with spaces');
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'hello.go'), 'package hello\n');
  // The desktop host must leave a separate CLI instance's lock untouched.
  const state = path.join(temp, 'state');
  fs.mkdirSync(path.join(state, 'faah'), { recursive: true });
  const lock = path.join(state, 'faah', 'workbench.lock');
  fs.writeFileSync(lock, 'separate-cli-lock');
  const backend = startBackend(executable, { cwd: temp, env: {
    ...process.env, XDG_STATE_HOME: state,
    XDG_CONFIG_HOME: path.join(temp, 'config'), FAAH_TELEMETRY: '0',
  } });
  let reader;
  try {
    const origin = await backend.ready;
    assert.equal(new URL(origin).hostname, '127.0.0.1');
    assert.equal(fs.readFileSync(lock, 'utf8'), 'separate-cli-lock');
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(await page.text(), /faah/);
    const opened = await fetch(origin + '/api/wb/open', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: workspace }),
    }).then(r => r.json());
    assert.ok(opened.href, JSON.stringify(opened));
    const deadline = Date.now() + 15_000;
    let meta;
    while (Date.now() < deadline) {
      const response = await fetch(origin + opened.href + 'api/meta');
      if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
        meta = await response.json();
        break;
      }
      await response.text();
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(meta?.root, fs.realpathSync(workspace));
    assert.equal(meta.workbench, '/');
    const stream = await fetch(origin + opened.href + 'api/stream', { signal: AbortSignal.timeout(10_000) });
    assert.equal(stream.headers.get('content-type'), 'text/event-stream');
    reader = stream.body.getReader();
    const first = await reader.read();
    assert.equal(first.done, false);
    assert.ok(first.value.length > 0);
    // Keep the event stream open while shutting down: it must not stall exit.
    await backend.stop();
    const result = await backend.exit;
    assert.equal(result.code, 0);
    assert.equal(fs.readFileSync(lock, 'utf8'), 'separate-cli-lock');
    await assert.rejects(fetch(origin, { signal: AbortSignal.timeout(1000) }));
  } finally {
    await reader?.cancel().catch(() => {});
    await backend.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
