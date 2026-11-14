import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { command } from '../../bench/util.ts';
import { primeGitCache } from '../src/legacy/cache.ts';

test('startup stat-cache refresh preserves staged content and tolerates non-Git roots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'faah-git-cache-'));
  try {
    await primeGitCache(root);
    await command(['git', 'init', '-q'], root);
    await writeFile(join(root, 'changed.txt'), 'staged\n');
    await writeFile(join(root, 'clean.txt'), 'clean\n');
    await command(['git', 'add', '.'], root);
    await writeFile(join(root, 'changed.txt'), 'working tree\n');
    await writeFile(join(root, 'clean.txt'), 'clean\n');
    await primeGitCache(root);
    expect(await command(['git', 'show', ':changed.txt'], root)).toBe('staged');
    expect(await command(['git', 'diff', '--name-only'], root)).toBe('changed.txt');
    expect(await command(['git', 'ls-files'], root)).toBe('changed.txt\nclean.txt');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
