#!/usr/bin/env node
/**
 * scripts/dev-desktop.js
 *
 * Runs the desktop app with hot reload. Changes in web/src are rebundled and
 * picked up by the open windows (desktop/dev-reload.cjs). Changes to the Go
 * backend or the Electron main process relaunch the app.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktop = path.join(root, 'desktop');
const electronDir = path.join(desktop, 'node_modules/electron');
const binary = path.join(desktop, 'bin', process.platform === 'win32' ? 'faah.exe' : 'faah');
const partialBinary = `${binary}.partial`;
const nextBinary = `${binary}.next`;
const DEBOUNCE_MS = 100;

let electron;
let relaunch = false;
let timer;
let draining = false;
const pending = new Set();

function run(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
    child.once('error', error => {
      console.error(`[dev-desktop] ${command}: ${error.message}`);
      resolve(false);
    });
    child.once('close', code => resolve(code === 0));
  });
}

function buildWeb() {
  return run(process.execPath, [path.join(root, 'scripts/build-web.js')]);
}

// The running app keeps its binary until it exits, and a slow quit can overlap
// the next build, so only a finished build ever becomes nextBinary.
async function buildBackend() {
  console.log('[dev-desktop] Building backend...');
  const ok = await run('go', ['build', '-o', partialBinary, '.'], {
    env: { ...process.env, CGO_ENABLED: '0' },
  });
  if (ok) fs.renameSync(partialBinary, nextBinary);
  return ok;
}

function installBackend() {
  if (fs.existsSync(nextBinary)) fs.renameSync(nextBinary, binary);
}

function launch() {
  const pkg = JSON.parse(fs.readFileSync(path.join(electronDir, 'package.json'), 'utf8'));
  const env = { ...process.env, FAAH_DEV_ROOT: root };
  // Coding tools can set this for their own Electron processes. Inheriting
  // it would turn the desktop runtime into a Node CLI instead of an app.
  delete env.ELECTRON_RUN_AS_NODE;
  electron = spawn(process.execPath, [path.join(electronDir, pkg.bin.electron), '.'], {
    cwd: desktop, env, stdio: 'inherit',
  });
  electron.once('close', code => {
    if (!relaunch) process.exit(code ?? 0);
    relaunch = false;
    installBackend();
    launch();
  });
}

// Electron turns SIGTERM into a normal quit, so a window with unsaved edits
// can still refuse. Builds do not wait for it: the relaunch happens on exit.
function requestRelaunch() {
  console.log('[dev-desktop] Relaunching...');
  relaunch = true;
  electron.kill('SIGTERM');
}

async function drain() {
  if (draining) return;
  draining = true;
  while (pending.size) {
    const kinds = new Set(pending);
    pending.clear();
    if (kinds.has('web')) await buildWeb();
    // A failed build leaves the running app alone until the error is fixed.
    const backendOk = !kinds.has('go') || await buildBackend();
    if (backendOk && (kinds.has('go') || kinds.has('main'))) requestRelaunch();
  }
  draining = false;
}

function watch(dir, recursive, kindOf) {
  fs.watch(path.join(root, dir), { recursive }, (_event, file) => {
    const kind = file && kindOf(file);
    if (!kind) return;
    pending.add(kind);
    clearTimeout(timer);
    timer = setTimeout(drain, DEBOUNCE_MS);
  });
}

function goKind(file) {
  return (file.endsWith('.go') && !file.endsWith('_test.go')) || file === 'go.mod' || file === 'go.sum' ? 'go' : null;
}

if (!fs.existsSync(electronDir)) {
  throw new Error('Install desktop build dependencies first: npm ci --prefix desktop');
}
fs.mkdirSync(path.dirname(binary), { recursive: true });
if (!await buildWeb() || !await buildBackend()) process.exit(1);
installBackend();

watch('web/src', true, file => (file.endsWith('.js') && !file.endsWith('.test.js') ? 'web' : null));
watch('.', false, goKind);
watch('internal', true, goKind);
watch('desktop', false, file => (file.endsWith('.cjs') && !file.endsWith('.test.cjs') ? 'main' : null));

launch();
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    relaunch = false;
    electron.kill(signal);
  });
}
