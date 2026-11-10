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
  assert.equal(await initial.webContents.executeJavaScript('!!document.querySelector("#wb-target")'), true);

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
