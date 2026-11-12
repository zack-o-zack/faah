#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
execFileSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run'], { stdio: 'inherit' });
execFileSync(process.execPath, ['scripts/build-web.js'], { stdio: 'inherit' });
