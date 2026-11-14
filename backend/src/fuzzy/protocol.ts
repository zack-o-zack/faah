import { record, string, number } from '../decode.ts';
import type { Result } from './score.ts';
export function strings(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('expected strings');
  return value.map((v) => string(v));
}
export function results(value: unknown): Result[] {
  if (!Array.isArray(value)) throw new Error('expected results');
  return value.map((row) => {
    const v = record(row);
    if (v.pos !== null && !Array.isArray(v.pos)) throw new Error('expected positions');
    return {
      path: string(v.path),
      name: string(v.name),
      score: number(v.score),
      pos: v.pos === null ? null : v.pos.map((p) => number(p)),
    };
  });
}
