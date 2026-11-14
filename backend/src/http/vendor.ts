import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { mkdir, rename, writeFile, readFile } from 'node:fs/promises';
export function vendorCacheDir(): string {
  return process.env.XDG_CACHE_HOME
    ? join(process.env.XDG_CACHE_HOME, 'faah/vendor')
    : join(homedir(), '.faah/cache/vendor');
}
const pending = new Map<string, Promise<Uint8Array | undefined>>();
export async function vendorAsset(rel: string): Promise<Uint8Array | undefined> {
  const path = join(vendorCacheDir(), basename(rel) + '.gz');
  try {
    return await readFile(path);
  } catch {
    /* A cache miss falls back to repository assets or the pinned CDN. */
  }
  try {
    return await readFile(join('web', rel + '.gz'));
  } catch {
    /* Compiled installations may have no repository beside them. */
  }
  if (rel !== 'vendor/mermaid-12.0.0.min.js') return;
  const old = pending.get(rel);
  if (old) return old;
  const work = (async () => {
    try {
      const response = await fetch(
        'https://cdn.jsdelivr.net/npm/mermaid@12.0.0/dist/mermaid.min.js',
        { signal: AbortSignal.timeout(30000) },
      );
      if (!response.ok) return;
      const bytes = Bun.gzipSync(await response.arrayBuffer(), { level: 9 });
      try {
        await mkdir(vendorCacheDir(), { recursive: true });
        const tmp = path + '.' + crypto.randomUUID() + '.tmp';
        await writeFile(tmp, bytes);
        await rename(tmp, path);
      } catch {
        /* The downloaded bytes remain usable when cache writes fail. */
      }
      return bytes;
    } catch {
      return;
    }
  })();
  pending.set(rel, work);
  try {
    return await work;
  } finally {
    pending.delete(rel);
  }
}
