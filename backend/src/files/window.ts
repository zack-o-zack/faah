const maxUnsigned = (1n << 64n) - 1n,
  maxSigned = (1n << 63n) - 1n,
  minSigned = -(1n << 63n);
// strconv.Atoi returns a saturated value on range errors; callers ignore the
// error. ParseUint's overflow also wins over invalid suffixes encountered later.
export function goInteger(text: string | null): bigint {
  if (!text) return 0n;
  let pos = 0,
    negative = false,
    value = 0n;
  if (text[0] === '-' || text[0] === '+') {
    negative = text[0] === '-';
    pos++;
  }
  if (pos === text.length) return 0n;
  for (; pos < text.length; pos++) {
    const digit = text.charCodeAt(pos) - 48;
    if (digit < 0 || digit > 9) return 0n;
    value = value * 10n + BigInt(digit);
    if (value > maxUnsigned) return negative ? minSigned : maxSigned;
  }
  return negative
    ? -value < minSigned
      ? minSigned
      : -value
    : value > maxSigned
      ? maxSigned
      : value;
}
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
