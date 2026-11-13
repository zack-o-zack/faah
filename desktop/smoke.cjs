// Run with Electron on a graphical desktop: npm run desktop:smoke (from root).
const { app, BrowserWindow, dialog, Menu, shell } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'faah-native-smoke-'));
const workspace = path.join(temp, 'workspace with spaces');
fs.mkdirSync(workspace);
fs.writeFileSync(path.join(workspace, 'hello.go'), 'package hello\n');
const userData = path.join(temp, 'user-data');
fs.mkdirSync(userData);
app.setPath('userData', userData);
process.env.XDG_STATE_HOME = path.join(temp, 'state');
process.env.XDG_CONFIG_HOME = path.join(temp, 'config');
process.env.FAAH_TELEMETRY = '0';

const external = [];
let confirmLeave = 0;
let confirmations = 0;
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspace] });
dialog.showMessageBoxSync = () => { confirmations++; return confirmLeave; };
dialog.showErrorBox = (title, message) => { throw new Error(`${title}: ${message}`); };
shell.openExternal = async url => { external.push(url); };

const timeout = setTimeout(() => {
  console.error('Native smoke test timed out.');
  app.exit(1);
}, 30_000);
app.once('will-quit', () => {
  clearTimeout(timeout);
  fs.rmSync(temp, { recursive: true, force: true });
});

function nextWindow() {
  return new Promise(resolve => app.once('browser-window-created', (_event, window) => {
    window.webContents.once('did-finish-load', () => resolve(window));
  }));
}

async function waitFor(check) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for the UI.');
}

const initialWindow = nextWindow();
require('./main.cjs');

void (async () => {
  const initial = await initialWindow;
  const origin = new URL(initial.webContents.getURL()).origin;
  assert.equal(new URL(origin).hostname, '127.0.0.1');
  assert.equal(await initial.webContents.executeJavaScript('typeof process'), 'undefined');
  const preferences = initial.webContents.getLastWebPreferences();
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  await waitFor(() => initial.webContents.executeJavaScript('!!document.querySelector("#wb-open input[role=combobox]")'));

  const workspaceWindow = nextWindow();
  const fileMenu = Menu.getApplicationMenu().items.find(item => item.label === 'File');
  fileMenu.submenu.items.find(item => item.label === 'Open Folder…').click();
  const window = await workspaceWindow;
  await waitFor(() => window.webContents.executeJavaScript('!!document.querySelector("#tree")'));
  assert.match(window.webContents.getURL(), /\/w\/[a-f0-9]+\//);

  await window.webContents.executeJavaScript('location.href = "https://example.com/faah-smoke";');
  await waitFor(() => external.length === 1);
  assert.equal(external[0], 'https://example.com/faah-smoke');
  assert.equal(new URL(window.webContents.getURL()).origin, origin);

  // Holding pages keep the selected theme and system fonts after rendering.
  const holding = new BrowserWindow({ show: false, webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false,
    preload: path.join(__dirname, 'preload.cjs'),
  } });
  try {
    for (const theme of ['faah', 'missing-theme', 'catppuccin-latte', 'nord']) {
      const response = await fetch(origin + '/api/settings', {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 'workbench.colorTheme': theme }),
      });
      assert.equal(response.status, 200);
      await response.text();
      await holding.loadURL(origin + '/w/smoke-missing/');
      await waitFor(() => holding.webContents.executeJavaScript('!!document.querySelector("main [role=alert]")'));
      const colors = await holding.webContents.executeJavaScript(`(() => {
        const root = getComputedStyle(document.documentElement);
        const probe = document.createElement('span');
        document.body.append(probe);
        const text = [
          ['main h1', '--foreground'], ['main p.text-muted-foreground', '--muted-foreground'],
          ['main [role=alert]', '--destructive'], ['main footer a[data-variant=ghost]', '--foreground'],
        ].filter(([selector]) => document.querySelector(selector)).map(([selector, token]) => {
          probe.style.color = 'var(' + token + ')';
          return {
            selector, token: root.getPropertyValue(token).trim(),
            actual: getComputedStyle(document.querySelector(selector)).color,
            expected: getComputedStyle(probe).color,
          };
        });
        probe.remove();
        return { theme: document.documentElement.dataset.theme,
          font: getComputedStyle(document.body).fontFamily, text };
      })()`);
      assert.equal(colors.theme, ['faah', 'missing-theme'].includes(theme) ? 'catppuccin-mocha' : theme);
      assert.equal(colors.font, 'system-ui, sans-serif');
      assert.ok(colors.text.length >= 3);
      for (const text of colors.text) {
        assert.ok(text.token, `${theme}: ${text.selector} has no theme color`);
        assert.equal(text.actual, text.expected, `${theme}: ${text.selector} text color`);
      }
    }
    // Exercise the real loading script with a slow start and a connection error.
    await holding.webContents.executeJavaScript(`
      window.smokePolls = 0;
      window.smokeReady = false;
      window.fetch = async () => {
        if (++window.smokePolls === 1) throw new Error('Temporary connection error');
        return { ok: true, json: async () => ({ items: [{
          href: location.pathname, state: window.smokeReady ? 'running' : 'starting',
          progress: 'Checking out repository',
        }] }) };
      };
      const mount = document.getElementById('root');
      mount.dataset.page = JSON.stringify({ ...JSON.parse(mount.dataset.page),
        Starting: true, Error: '', Progress: '' });
      mount.replaceChildren();
      const script = document.createElement('script');
      script.src = 'static/holding.js';
      document.head.append(script);
    `);
    await waitFor(() => holding.webContents.executeJavaScript('!!document.querySelector("[role=status] .animate-spin")'));
    await holding.webContents.executeJavaScript(`
      window.smokeSpinner = document.querySelector('[role=status] .animate-spin');
      window.smokeAnimation = window.smokeSpinner.getAnimations()[0];
    `);
    await waitFor(() => holding.webContents.executeJavaScript('window.smokePolls >= 3'));
    const animation = await holding.webContents.executeJavaScript(`({
      same: document.querySelector('[role=status] .animate-spin') === window.smokeSpinner &&
        window.smokeSpinner.getAnimations()[0] === window.smokeAnimation,
      elapsed: window.smokeAnimation?.currentTime,
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      progress: document.querySelector('[role=status]').textContent,
    })`);
    assert.equal(animation.same, true, 'polls must preserve the document and spinner animation');
    if (!animation.reduced) assert.ok(animation.elapsed >= 1000, 'spinner must run across polls');
    assert.equal(animation.progress, 'Checking out repository…');
    const navigated = new Promise(resolve => holding.webContents.once('did-finish-load', resolve));
    await holding.webContents.executeJavaScript('window.smokeReady = true');
    await navigated;
    assert.equal(await holding.webContents.executeJavaScript('typeof window.smokeReady'), 'undefined');
  } finally {
    holding.destroy();
  }
  console.log('Native smoke passed: holding-page colors, typography, theme fallback, and continuous spinner through polling.');

  await window.webContents.executeJavaScript(`
    window.smokeGuard = event => { event.preventDefault(); event.returnValue = ''; };
    addEventListener('beforeunload', window.smokeGuard);
  `, true);
  app.quit();
  await waitFor(() => confirmations > 0);
  assert.equal(window.isDestroyed(), false, 'Stay must cancel quitting');
  assert.equal((await fetch(origin + '/api/wb/ping')).status, 200, 'backend must survive cancelled Quit');
  confirmLeave = 1;
  console.log('Native smoke passed: sandbox, workbench, folder menu, workspace, external links, and cancelled Quit.');
  app.once('will-quit', () => console.log('Native smoke passed: confirmed Quit stopped the backend.'));
  app.quit();
})().catch(error => {
  console.error(error);
  app.exit(1);
});
