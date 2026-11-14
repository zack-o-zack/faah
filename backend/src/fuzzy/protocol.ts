import { string } from '../decode.ts';
export function strings(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('expected strings');
  return value.map((v) => string(v));
}
export function candidates(value: unknown): Int32Array {
  if (!(value instanceof Int32Array) || value.length % 2)
    throw new Error('expected packed candidates');
  return value;
}
