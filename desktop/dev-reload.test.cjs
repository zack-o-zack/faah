const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { reloadKind, watchAssets } = require('./dev-reload.cjs');

test('stylesheets swap in place and page assets reload', () => {
  assert.equal(reloadKind('style.css'), 'styles');
  assert.equal(reloadKind(path.join('themes', 'nord.css')), 'styles');
  assert.equal(reloadKind('app.js'), 'page');
  assert.equal(reloadKind('workbench.html'), 'page');
});

test('bundler inputs and unrelated files are ignored', () => {
  assert.equal(reloadKind(path.join('src', 'main.js')), null);
  assert.equal(reloadKind(path.join('vendor', 'mermaid.min.js.gz')), null);
  assert.equal(reloadKind('.DS_Store'), null);
});

test('a burst of changes reloads each window once and page wins over styles', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'faah-dev-reload-'));
  fs.mkdirSync(path.join(root, 'web'));
  fs.writeFileSync(path.join(root, 'web', 'style.css'), '');
  fs.writeFileSync(path.join(root, 'web', 'app.js'), '');
  let reloads = 0;
  let swaps = 0;
  const window = { webContents: {
    reload: () => { reloads += 1; },
    executeJavaScript: async () => { swaps += 1; },
  } };
  const watcher = watchAssets(root, () => [window]);
  try {
    await new Promise(resolve => setTimeout(resolve, 200));
    fs.writeFileSync(path.join(root, 'web', 'style.css'), 'a{}');
    fs.writeFileSync(path.join(root, 'web', 'app.js'), '1');
    for (let i = 0; i < 100 && !reloads; i += 1) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(reloads, 1);
    assert.equal(swaps, 0);
  } finally {
    watcher.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
