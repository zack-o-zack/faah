#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const targets = [
  'web/src',
  'vite.config.js',
  'eslint.config.js',
  'scripts/build-web.js',
  'scripts/check-web.js',
];
execFileSync(process.execPath, ['node_modules/prettier/bin/prettier.cjs', '--check', ...targets], {
  stdio: 'inherit',
});
execFileSync(process.execPath, ['node_modules/eslint/bin/eslint.js', ...targets], {
  stdio: 'inherit',
});
execFileSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run'], { stdio: 'inherit' });
execFileSync(process.execPath, ['scripts/build-web.js'], { stdio: 'inherit' });
