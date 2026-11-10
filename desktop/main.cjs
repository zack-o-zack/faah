const { app, BrowserWindow, dialog, Menu, session, shell } = require('electron');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { startBackend } = require('./backend.cjs');
const { isInternalURL, isExternalURL, workbenchURL } = require('./navigation.cjs');

let backend;
let origin;
let quitting = false;
let quitRequested = false;
let pendingTarget;

app.setName('faah');

function openExternal(url) {
  if (isExternalURL(url)) void shell.openExternal(url).catch(error => {
    dialog.showErrorBox('Could not open link', error.message);
  });
}

function createWindow(url = workbenchURL(origin)) {
  const window = new BrowserWindow({
    title: 'faah', width: 1440, height: 960, minWidth: 800, minHeight: 560,
    backgroundColor: '#111113', show: false, autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, spellcheck: false, partition: 'faah-desktop',
    },
  });
  window.once('ready-to-show', () => window.show());
  const contents = window.webContents;
  for (const event of ['will-navigate', 'will-redirect']) {
    contents.on(event, (e, target) => {
      if (isInternalURL(target, origin)) return;
      e.preventDefault();
      openExternal(target);
    });
  }
  contents.on('will-attach-webview', e => e.preventDefault());
  contents.setWindowOpenHandler(({ url: target }) => {
    if (isInternalURL(target, origin)) createWindow(target);
    else openExternal(target);
    // about:blank is denied, so PR launch falls back to this window once
    // its asynchronous workspace request completes.
    return { action: 'deny' };
  });
  contents.on('will-prevent-unload', e => {
    const leave = dialog.showMessageBoxSync(window, {
      type: 'warning', title: 'Leave this workspace?',
      message: 'You have unsaved edits or an agent is still running.',
      detail: 'Leaving may discard edits or interrupt work.',
      buttons: ['Stay', 'Leave'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (leave === 1) e.preventDefault();
    else quitRequested = false;
  });
  void window.loadURL(url).catch(error => {
    if (!window.isDestroyed() && error.code !== 'ERR_ABORTED') {
      dialog.showErrorBox('Could not open faah', error.message);
      window.close();
    }
  });
  return window;
}

function openTarget(target) {
  if (!origin) { pendingTarget = target; return; }
  // A new window keeps any unsaved edits in the current workspace intact.
  createWindow(workbenchURL(origin, target));
}

async function chooseFolder() {
  const options = { title: 'Open a workspace', properties: ['openDirectory'] };
  const window = BrowserWindow.getFocusedWindow();
  const result = await (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options));
  if (!result.canceled) openTarget(result.filePaths[0]);
}

function installMenu() {
  const mac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(mac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: () => { void chooseFolder(); } },
      { label: 'New Workbench Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow() },
      { type: 'separator' },
      { role: 'close' },
      ...(!mac ? [{ role: 'quit' }] : []),
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { label: 'Show Workbench', accelerator: 'CmdOrCtrl+Shift+H', click: () => createWindow() },
      { role: 'togglefullscreen' },
      ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : []),
    ] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [
      { label: 'faah Documentation', click: () => openExternal('https://github.com/zack-o-zack/faah#readme') },
    ] },
  ]));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('open-file', (event, target) => { event.preventDefault(); openTarget(target); });
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
    else if (origin) createWindow();
  });
  app.on('activate', () => {
    if (origin && !quitting && BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on('window-all-closed', () => {
    if (quitRequested || process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', event => {
    if (quitting) return;
    // Close normally first so each renderer can protect unsaved work. A
    // cancelled close leaves both the app and its backend running.
    if (BrowserWindow.getAllWindows().length) {
      event.preventDefault();
      quitRequested = true;
      for (const window of BrowserWindow.getAllWindows()) window.close();
      return;
    }
    if (!backend) return;
    event.preventDefault();
    quitting = true;
    void backend.stop().finally(() => app.quit());
  });

  void app.whenReady().then(async () => {
    const desktopSession = session.fromPartition('faah-desktop');
    desktopSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
      callback(permission === 'clipboard-sanitized-write' && isInternalURL(details.requestingUrl, origin));
    });
    desktopSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
      permission === 'clipboard-sanitized-write' && isInternalURL(requestingOrigin, origin));

    const executable = path.join(app.isPackaged ? process.resourcesPath : __dirname, 'bin',
      process.platform === 'win32' ? 'faah.exe' : 'faah');
    // Finder does not inherit a terminal's PATH. Read only PATH from the
    // login shell so Git, language servers, and installed agents are found.
    const env = { ...process.env };
    if (process.platform === 'darwin') {
      try {
        const { stdout } = await promisify(execFile)(process.env.SHELL || '/bin/zsh',
          ['-ilc', 'printf "\\nFAAH_DESKTOP_PATH=%s\\n" "$PATH"'], { timeout: 5000, encoding: 'utf8' });
        const shellPath = stdout.split('\n').find(line => line.startsWith('FAAH_DESKTOP_PATH='));
        if (shellPath) env.PATH = shellPath.slice('FAAH_DESKTOP_PATH='.length);
      } catch {
        env.PATH = [env.PATH, '/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local/bin')]
          .filter(Boolean).join(path.delimiter);
      }
    }
    if (quitting) return;
    backend = startBackend(executable, { cwd: os.homedir(), env });
    origin = await backend.ready;
    backend.exit.then(result => {
      if (backend.stopping) return;
      dialog.showErrorBox('faah stopped unexpectedly', result.error?.message || 'Quit and reopen faah to restart the backend.');
      app.quit();
    });
    installMenu();
    createWindow(workbenchURL(origin, pendingTarget));
  }).catch(async error => {
    dialog.showErrorBox('Could not start faah', error.message);
    await backend?.stop();
    app.quit();
  });
}
