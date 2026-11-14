import { lower, compare, trimSpace } from '../text.ts';
export interface Item {
  path: string;
  name: string;
  size: number;
  lower: string;
  nameStart: number;
  bytes: Buffer;
  lowerBytes: Buffer;
  walked: boolean;
}
export interface Result {
  path: string;
  name: string;
  pos: number[] | null;
  score: number;
}
export function newItem(path: string, size = 0, walked = false): Item {
  const index = path.lastIndexOf('/');
  return {
    path,
    name: path.slice(index + 1),
    size,
    lower: lower(path),
    nameStart: Buffer.byteLength(path.slice(0, index + 1)),
    bytes: Buffer.from(path),
    lowerBytes: Buffer.from(lower(path)),
    walked,
  };
}
export function isBoundary(byte: number): boolean {
  return [47, 95, 45, 46, 32, 64].includes(byte);
}
export function score(options: {
  item: Item;
  query: Uint8Array;
  original: Uint8Array;
}): Result | undefined {
  const { item, query: q, original } = options;
  const p = item.bytes,
    lp = item.lowerBytes;
  let qi = 0,
    end = -1;
  for (let i = 0; i < lp.length && qi < q.length; i++)
    if (lp[i] === q[qi]) {
      qi++;
      end = i;
    }
  if (qi < q.length) return;
  const pos: number[] = [];
  qi = q.length - 1;
  for (let i = end; i >= 0 && qi >= 0; i--)
    if (lp[i] === q[qi]) {
      pos.push(i);
      qi--;
    }
  pos.reverse();
  let value = 0,
    previous = -2;
  for (const [k, i] of pos.entries()) {
    const byte = p[i] ?? 0,
      prev = p[i - 1] ?? 0;
    if (i === previous + 1) value += 12;
    else if (k > 0) value -= Math.min(i - previous, 12);
    if (i >= item.nameStart) value += 14;
    if (i === 0 || isBoundary(prev)) value += 16;
    else if (byte >= 65 && byte <= 90 && prev >= 97 && prev <= 122) value += 14;
    if (k < original.length && byte === original[k]) value += 4;
    previous = i;
  }
  value -= Math.floor(p.length / 8) + (item.path.match(/\//g)?.length ?? 0) * 2;
  const idx = lp.subarray(item.nameStart).indexOf(q);
  if (idx >= 0) {
    value += 40;
    if (idx === 0) value += 20;
  }
  return { path: item.path, name: item.name, pos, score: value };
}
export function rank(a: Result, b: Result): number {
  return b.score - a.score || compare(a.path, b.path);
}
function sift(heap: Result[], index: number): void {
  while (true) {
    const left = index * 2 + 1;
    if (left >= heap.length) return;
    let worst = left;
    const right = heap[left + 1],
      l = heap[left];
    if (right && l && rank(right, l) > 0) worst = left + 1;
    const next = heap[worst],
      current = heap[index];
    if (!next || !current || rank(next, current) <= 0) return;
    heap[index] = next;
    heap[worst] = current;
    index = worst;
  }
}
export function find(items: Item[], query: string, limit: number): Result[] {
  const original = trimSpace(query).replace(/ /g, '');
  if (!original)
    return items
      .slice(0, limit >= 0 ? limit : undefined)
      .map((it) => ({ path: it.path, name: it.name, pos: null, score: 0 }));
  const q = Buffer.from(lower(original)),
    orig = Buffer.from(original);
  const heap: Result[] = [];
  for (const item of items) {
    const result = score({ item, query: q, original: orig });
    if (!result) continue;
    if (limit <= 0 || heap.length < limit) {
      heap.push(result);
      if (heap.length === limit) for (let i = Math.floor(limit / 2) - 1; i >= 0; i--) sift(heap, i);
    } else if (heap[0] && rank(result, heap[0]) < 0) {
      heap[0] = result;
      sift(heap, 0);
    }
  }
  return heap.sort(rank);
}
