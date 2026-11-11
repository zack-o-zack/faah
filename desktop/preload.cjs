// Sandboxed, so electron is the only module available. Nothing is exposed to the
// page: this file marks the document and talks to the main process itself.
const { ipcRenderer } = require('electron');

const PLATFORMS = { darwin: 'mac', win32: 'win', linux: 'linux' };

function markShell() {
  const root = document.documentElement;
  if (!root) return false;
  root.dataset.shell = 'desktop';
  root.dataset.platform = PLATFORMS[process.platform] || process.platform;
  if (process.platform !== 'linux') root.dataset.titlebar = 'integrated';
  return true;
}

// Preload can run before <html> exists. Marking it from here is still ahead of
// first paint, so desktop variants apply before the first frame.
if (!markShell()) {
  new MutationObserver((_records, observer) => {
    if (markShell()) observer.disconnect();
  }).observe(document, { childList: true });
}

function reportColors() {
  const style = getComputedStyle(document.documentElement);
  ipcRenderer.send('faah:chrome', {
    color: style.getPropertyValue('--bg2').trim(),
    symbolColor: style.getPropertyValue('--fg').trim(),
  });
}

window.addEventListener('load', () => {
  reportColors();
  new MutationObserver(reportColors).observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-theme'],
  });
});

document.addEventListener('click', event => {
  const button = event.target.closest?.('[data-desktop-menu]');
  if (!button) return;
  const { left, bottom } = button.getBoundingClientRect();
  ipcRenderer.send('faah:menu', { x: left, y: bottom });
});
