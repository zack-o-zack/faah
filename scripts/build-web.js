#!/usr/bin/env node
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
fs.mkdirSync('web/dist', { recursive: true });
for (const entry of ['app', 'workbench', 'holding']) {
  execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
    stdio: 'inherit',
    env: { ...process.env, WEB_ENTRY: entry },
  });
}
execFileSync(
  process.execPath,
  [
    'node_modules/@tailwindcss/cli/dist/index.mjs',
    '-i',
    'web/tailwind.css',
    '-o',
    'web/dist/app.css',
    '--minify',
  ],
  { stdio: 'inherit' },
);
// Tailwind leaves url() assets in place; ship only the Latin faces we declare.
fs.rmSync('web/dist/fonts', { recursive: true, force: true });
fs.mkdirSync('web/dist/fonts', { recursive: true });
fs.mkdirSync('web/dist/font-licenses', { recursive: true });
for (const [family, styles] of [
  ['figtree', ['normal', 'italic']],
  ['fraunces', ['normal']],
  ['jetbrains-mono', ['normal', 'italic']],
]) {
  const source = `node_modules/@fontsource-variable/${family}`;
  for (const style of styles) {
    const file = `${family}-latin-wght-${style}.woff2`;
    fs.copyFileSync(`${source}/files/${file}`, `web/dist/fonts/${file}`);
  }
  fs.copyFileSync(`${source}/LICENSE`, `web/dist/font-licenses/${family}.txt`);
}
for (const name of fs.readdirSync('web/vendor')) {
  if (!name.endsWith('.min.js')) continue;
  const path = `web/vendor/${name}`;
  fs.writeFileSync(`${path}.gz`, gzipSync(fs.readFileSync(path), { level: 9 }));
  fs.unlinkSync(path);
}
