import { record, string, number } from '../decode.ts';
import type { Symbol } from './service.ts';
export function decodeSymbols(value: unknown): Symbol[] {
  if (!Array.isArray(value)) throw new Error('invalid symbols');
  return value.map((row) => {
    const symbol = record(row);
    return {
      name: string(symbol.name),
      kind: string(symbol.kind),
      line: number(symbol.line),
      indent: number(symbol.indent),
    };
  });
}
