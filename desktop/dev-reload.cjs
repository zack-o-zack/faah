const fs = require('node:fs');
const path = require('node:path');

const DEBOUNCE_MS = 150;

function sourceKind(file) {
  return /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.endsWith('.d.ts') ? 'web' : null;
}

// Swaps stylesheets in place, which keeps scroll position and open panels.
const SWAP_STYLES = `for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
  const url = new URL(link.href);
  if (url.origin === location.origin) { url.searchParams.set('dev', Date.now()); link.href = url; }
}`;

// web/src is only an input to web/dist/app.js, which reports its own change.
function reloadKind(file) {
  const [top] = file.split(path.sep);
  if (top === 'src' || top === 'vendor') return null;
  if (file === 'tailwind.css') return null;
  if (file.endsWith('.css')) return 'styles';
  return /\.(js|html|svg)$/.test(file) ? 'page' : null;
}

function watchAssets(root, getWindows) {
  let timer;
  let kind;
  return fs.watch(path.join(root, 'web'), { recursive: true }, (_event, file) => {
    const change = file && reloadKind(file);
    if (!change) return;
    kind = kind === 'page' ? kind : change;
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const window of getWindows()) {
        if (kind === 'page') window.webContents.reload();
        else void window.webContents.executeJavaScript(SWAP_STYLES).catch(() => {});
      }
      kind = undefined;
    }, DEBOUNCE_MS);
  });
}

module.exports = { sourceKind, reloadKind, watchAssets };
