#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const targets = [
  'web/src',
  'vite.config.ts',
  'eslint.config.js',
  'scripts/build-web.js',
  'scripts/check-web.js',
  'scripts/eslint-typescript/index.js',
];
execFileSync(process.execPath, ['node_modules/prettier/bin/prettier.cjs', '--check', ...targets], {
  stdio: 'inherit',
});
execFileSync(process.execPath, ['node_modules/eslint/bin/eslint.js', ...targets], {
  stdio: 'inherit',
});
// The native compiler: node_modules/typescript/bin/tsc starts the TypeScript 7 Go binary.
for (const project of ['tsconfig.json', 'tsconfig.node.json'])
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '-p', project], {
    stdio: 'inherit',
  });
execFileSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run'], { stdio: 'inherit' });
execFileSync(process.execPath, ['scripts/build-web.js'], { stdio: 'inherit' });
