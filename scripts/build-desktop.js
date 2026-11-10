#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktop = path.join(root, 'desktop');
const args = process.argv.slice(2);
const archArg = args.find(arg => arg.startsWith('--arch='));
const arch = archArg?.slice(7) || process.arch;
if (!['arm64', 'x64'].includes(arch) || args.some(arg =>
  !['--run', '--smoke', '--package', '--dist', '--backend-only', '--arch=x64', '--arch=arm64'].includes(arg))) {
  throw new Error('Usage: node scripts/build-desktop.js [--run|--smoke|--package|--dist|--backend-only] [--arch=x64|--arch=arm64]');
}
if (!['darwin', 'win32', 'linux'].includes(process.platform)) {
  throw new Error('The desktop app supports macOS, Windows, and Linux.');
}

function run(command, argv, options = {}) {
  execFileSync(command, argv, { cwd: root, stdio: 'inherit', ...options });
}

run(process.execPath, [path.join(root, 'scripts/build-web.js')]);
fs.mkdirSync(path.join(desktop, 'bin'), { recursive: true });
const binary = path.join(desktop, 'bin', process.platform === 'win32' ? 'faah.exe' : 'faah');
run('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', binary, '.'], {
  env: { ...process.env, CGO_ENABLED: '0', GOOS: { darwin: 'darwin', win32: 'windows', linux: 'linux' }[process.platform],
    GOARCH: arch === 'x64' ? 'amd64' : 'arm64' },
});

const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
if (!args.includes('--backend-only')) {
  if (!fs.existsSync(path.join(desktop, 'node_modules/electron'))) {
    throw new Error('Install desktop build dependencies first: npm ci --prefix desktop');
  }
  if (args.includes('--run') || args.includes('--smoke')) {
    if (arch !== process.arch) throw new Error('--run and --smoke require the host architecture.');
    const electron = JSON.parse(fs.readFileSync(path.join(desktop, 'node_modules/electron/package.json'), 'utf8'));
    const desktopEnv = { ...process.env };
    // Coding tools can set this for their own Electron processes. Inheriting
    // it would turn the desktop runtime into a Node CLI instead of an app.
    delete desktopEnv.ELECTRON_RUN_AS_NODE;
    run(process.execPath, [path.join(desktop, 'node_modules/electron', electron.bin.electron),
      args.includes('--smoke') ? 'smoke.cjs' : '.'], {
      cwd: desktop, env: desktopEnv,
    });
  } else {
    run(process.execPath, [path.join(desktop, 'node_modules/electron-builder/cli.js'),
      ...(args.includes('--dist') ? [] : ['--dir']), `--${arch}`, '--publish', 'never',
      `--config.extraMetadata.version=${version}`], { cwd: desktop });
  }
}
