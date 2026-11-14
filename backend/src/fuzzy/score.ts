import { lower, compare, trimSpace } from '../text.ts';
export interface Item {
  path: string;
  name: string;
  size: number;
  lower: string;
  nameStart: number;
  bytes: Buffer;
  lowerBytes: Buffer;
  penalty: number;
  walked: boolean;
}
export interface Result {
  path: string;
  name: string;
  pos: number[] | null;
  score: number;
}
export interface Query {
  bytes: Buffer;
  original: Buffer;
}
export interface Candidate {
  item: Item;
  index: number;
  score: number;
}
export function newItem(path: string, size = 0, walked = false): Item {
  const index = path.lastIndexOf('/'),
    bytes = Buffer.from(path),
    lowered = lower(path);
  let depth = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 47) depth++;
  return {
    path,
    name: path.slice(index + 1),
    size,
    lower: lowered,
    nameStart: bytes.lastIndexOf(47) + 1,
    bytes,
    lowerBytes: Buffer.from(lowered),
    penalty: Math.floor(bytes.length / 8) + depth * 2,
    walked,
  };
}
export function prepareQuery(query: string): Query {
  const original = trimSpace(query).replace(/ /g, '');
  return { bytes: Buffer.from(lower(original)), original: Buffer.from(original) };
}
export function isBoundary(byte: number): boolean {
  return byte === 47 || byte === 95 || byte === 45 || byte === 46 || byte === 32 || byte === 64;
}
// The right-to-left pass charges each gap to its right-hand match. This is the
// same sum as Go's position loop, without allocating positions for rejected hits.
function value(item: Item, q: Uint8Array, original: Uint8Array): number | undefined {
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
  let score = -item.penalty,
    next = -1;
  qi = q.length - 1;
  for (let i = end; i >= 0 && qi >= 0; i--) {
    if (lp[i] !== q[qi]) continue;
    const byte = p[i] ?? 0,
      prev = p[i - 1] ?? 0;
    if (next >= 0) score += next === i + 1 ? 12 : -Math.min(next - i, 12);
    if (i >= item.nameStart) score += 14;
    if (i === 0 || isBoundary(prev)) score += 16;
    else if (byte >= 65 && byte <= 90 && prev >= 97 && prev <= 122) score += 14;
    if (qi < original.length && byte === original[qi]) score += 4;
    next = i;
    qi--;
  }
  if (item.nameStart <= lp.length) {
    const index = lp.indexOf(q, item.nameStart);
    if (index >= 0) score += index === item.nameStart ? 60 : 40;
  }
  return score;
}
function positions(item: Item, q: Uint8Array): number[] {
  const lp = item.lowerBytes;
  let qi = 0,
    end = -1;
  for (let i = 0; i < lp.length && qi < q.length; i++)
    if (lp[i] === q[qi]) {
      qi++;
      end = i;
    }
  const pos: number[] = [];
  qi = q.length - 1;
  for (let i = end; i >= 0 && qi >= 0; i--)
    if (lp[i] === q[qi]) {
      pos[qi] = i;
      qi--;
    }
  return pos;
}
export function score(options: {
  item: Item;
  query: Uint8Array;
  original: Uint8Array;
}): Result | undefined {
  const { item, query, original } = options;
  const score = value(item, query, original);
  if (score === undefined) return;
  return { path: item.path, name: item.name, pos: positions(item, query), score };
}
export function rank(a: Result, b: Result): number {
  return b.score - a.score || compare(a.path, b.path);
}
export function rankCandidates(a: Candidate, b: Candidate): number {
  return b.score - a.score || Buffer.compare(a.item.bytes, b.item.bytes);
}
function sift(heap: Candidate[], index: number): void {
  while (true) {
    const left = index * 2 + 1;
    if (left >= heap.length) return;
    let worst = left;
    const right = heap[left + 1],
      l = heap[left];
    if (right && l && rankCandidates(right, l) > 0) worst = left + 1;
    const next = heap[worst],
      current = heap[index];
    if (!next || !current || rankCandidates(next, current) <= 0) return;
    heap[index] = next;
    heap[worst] = current;
    index = worst;
  }
}
export function select(items: Item[], query: Query, limit: number): Candidate[] {
  const heap: Candidate[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (!item) continue;
    const score = value(item, query.bytes, query.original);
    if (score === undefined) continue;
    if (limit <= 0 || heap.length < limit) {
      heap.push({ item, index, score });
      if (heap.length === limit) for (let i = Math.floor(limit / 2) - 1; i >= 0; i--) sift(heap, i);
    } else {
      const worst = heap[0];
      if (
        worst &&
        (score > worst.score ||
          (score === worst.score && Buffer.compare(item.bytes, worst.item.bytes) < 0))
      ) {
        heap[0] = { item, index, score };
        sift(heap, 0);
      }
    }
  }
  return heap.sort(rankCandidates);
}
export function materialize(candidates: Candidate[], query: Query): Result[] {
  return candidates.map(({ item, score }) => ({
    path: item.path,
    name: item.name,
    score,
    pos: positions(item, query.bytes),
  }));
}
export function find(items: Item[], query: string, limit: number): Result[] {
  const prepared = prepareQuery(query);
  if (!prepared.bytes.length)
    return items
      .slice(0, limit >= 0 ? limit : undefined)
      .map((it) => ({ path: it.path, name: it.name, pos: null, score: 0 }));
  return materialize(select(items, prepared, limit), prepared);
}
