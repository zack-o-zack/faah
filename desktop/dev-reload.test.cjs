const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { sourceKind, reloadKind, watchAssets } = require('./dev-reload.cjs');

test('stylesheets swap in place and page assets reload', () => {
  assert.equal(reloadKind(path.join('dist', 'app.css')), 'styles');
  assert.equal(reloadKind(path.join('themes', 'nord.css')), 'styles');
  assert.equal(reloadKind(path.join('dist', 'app.js')), 'page');
  assert.equal(reloadKind('workbench.html'), 'page');
  assert.equal(reloadKind(path.join('custom', 'theme.css')), 'styles');
});

test('bundler inputs and unrelated files are ignored', () => {
  assert.equal(reloadKind('tailwind.css'), null);
  assert.equal(reloadKind(path.join('src', 'main.tsx')), null);
  assert.equal(reloadKind(path.join('vendor', 'mermaid.min.js.gz')), null);
  assert.equal(reloadKind('.DS_Store'), null);
});

test('a burst of changes reloads each window once and page wins over styles', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'faah-dev-reload-'));
  fs.mkdirSync(path.join(root, 'web', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'web', 'dist', 'app.css'), '');
  fs.writeFileSync(path.join(root, 'web', 'dist', 'app.js'), '');
  let reloads = 0;
  let swaps = 0;
  const window = { webContents: {
    reload: () => { reloads += 1; },
    executeJavaScript: async () => { swaps += 1; },
  } };
  const watcher = watchAssets(root, () => [window]);
  try {
    await new Promise(resolve => setTimeout(resolve, 200));
    fs.writeFileSync(path.join(root, 'web', 'dist', 'app.css'), 'a{}');
    fs.writeFileSync(path.join(root, 'web', 'dist', 'app.js'), '1');
    for (let i = 0; i < 100 && !reloads; i += 1) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(reloads, 1);
    assert.equal(swaps, 0);
  } finally {
    watcher.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TypeScript sources rebuild while tests and declarations are ignored', () => {
  for (const file of ['main.tsx', 'store.ts', path.join('editor', 'EditView.tsx')]) {
    assert.equal(sourceKind(file), 'web', file);
  }
  for (const file of ['store.test.ts', 'EditView.test.tsx', 'solid.d.ts', 'main.js', 'main.jsx', 'README.md']) {
    assert.equal(sourceKind(file), null, file);
  }
});
