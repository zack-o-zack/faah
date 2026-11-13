import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { array, command, object, str } from './util.ts';

export interface Repo {
  name: string;
  url: string;
  sha: string;
}
const manifest = new URL('./corpus.json', import.meta.url);
export const cache = join(homedir(), '.cache/faah-bench/repos');
export async function corpus(): Promise<Repo[]> {
  const json: unknown = JSON.parse(await readFile(manifest, 'utf8'));
  return array(json).map((value) => {
    const row = object(value);
    return { name: str(row.name), url: str(row.url), sha: str(row.sha) };
  });
}
export async function ensureCorpus(): Promise<void> {
  const pinned = await corpus();
  const repos: Repo[] = [];
  await mkdir(cache, { recursive: true });
  for (const [name, url] of Object.entries({
    flask: 'https://github.com/pallets/flask',
    redis: 'https://github.com/redis/redis',
    react: 'https://github.com/facebook/react',
    kubernetes: 'https://github.com/kubernetes/kubernetes',
  })) {
    const dir = join(cache, name);
    const pin = pinned.find((repo) => repo.name === name);
    try {
      await command(['git', '-C', dir, 'rev-parse', '--git-dir']);
    } catch {
      await command(['git', 'clone', '--depth=1', url, dir]);
    }
    const sha = pin?.sha ?? (await command(['git', '-C', dir, 'rev-parse', 'HEAD']));
    try {
      await command(['git', '-C', dir, 'cat-file', '-e', `${sha}^{commit}`]);
    } catch {
      await command(['git', '-C', dir, 'fetch', '--depth=1', 'origin', sha]);
    }
    await command(['git', '-C', dir, 'checkout', '--detach', sha]);
    repos.push({ name, url, sha });
    // Persist each pin immediately, including when a later clone is interrupted.
    await writeFile(
      manifest,
      JSON.stringify(
        [...repos, ...pinned.filter((r) => !repos.some((p) => p.name === r.name))],
        null,
        2,
      ) + '\n',
    );
    console.log(`${name} ${sha}`);
  }
}
if (import.meta.main) await ensureCorpus();
