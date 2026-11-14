import type { Highlight } from '../render/document.ts';
import { LRU } from '../render/lru.ts';
import { sizeOfLines } from '../render/document.ts';
const caches = new WeakMap<Highlight, LRU<string[]>>();
export async function highlightedFence(
  highlight: Highlight,
  code: string,
  lang: string,
): Promise<string[]> {
  let cache = caches.get(highlight);
  if (!cache) {
    cache = new LRU(1 << 20);
    caches.set(highlight, cache);
  }
  const key = lang + '\0' + code,
    cached = cache.get(key);
  if (cached) return cached;
  const lines = await highlight(code, lang, code.split('\n').length),
    size = sizeOfLines(lines) + Buffer.byteLength(key);
  if (size <= cache.budget) cache.put(key, lines, size);
  return lines;
}
