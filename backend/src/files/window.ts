import { goInteger } from '../compat/go-numbers.ts';

export function fileWindow(
  total: number,
  startText: string | null,
  countText: string | null,
): { start: number; end: number } {
  const parsed = goInteger(startText),
    start = parsed < 0n ? 0 : parsed > BigInt(total) ? total : Number(parsed);
  const parsedCount = goInteger(countText),
    count = parsedCount <= 0n ? 1000n : parsedCount;
  return { start, end: Number(BigInt.asIntN(64, BigInt(start) + count)) };
}
