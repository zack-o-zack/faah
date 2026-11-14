import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { command } from '../../bench/util.ts';
import { primeGitCache } from '../src/git/cache.ts';
import { GitProcesses } from '../src/git/process.ts';

test('startup stat-cache refresh preserves staged content and tolerates non-Git roots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'faah-git-cache-'));
  const processes = new GitProcesses();
  try {
    await primeGitCache(root, processes);
    await command(['git', 'init', '-q'], root);
    await writeFile(join(root, 'changed.txt'), 'staged\n');
    await writeFile(join(root, 'clean.txt'), 'clean\n');
    await command(['git', 'add', '.'], root);
    await writeFile(join(root, 'changed.txt'), 'working tree\n');
    await writeFile(join(root, 'clean.txt'), 'clean\n');
    await primeGitCache(root, processes);
    expect(await command(['git', 'show', ':changed.txt'], root)).toBe('staged');
    expect(await command(['git', 'diff', '--name-only'], root)).toBe('changed.txt');
    expect(await command(['git', 'ls-files'], root)).toBe('changed.txt\nclean.txt');
  } finally {
    await processes.close();
    await rm(root, { recursive: true, force: true });
  }
});
