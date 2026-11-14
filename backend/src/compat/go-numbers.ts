// Integer parsing as Go's strconv does it.

/** strconv.Atoi: decimal digits with an optional sign, within int64, else no value. */
export function atoi(value: string): number | undefined {
  if (!/^[+-]?\d+$/.test(value)) return;
  const integer = BigInt(value);
  if (integer < -9223372036854775808n || integer > 9223372036854775807n) return;
  return Number(integer);
}

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
  if (text.startsWith('-') || text.startsWith('+')) {
    negative = text.startsWith('-');
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
