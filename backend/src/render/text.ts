import { isUtf8 } from 'node:buffer';
// Go's JSON encoder replaces each invalid UTF-8 byte. TextDecoder instead
// consumes a truncated sequence as one error, changing raw lines and widths.
export function goString(input: Uint8Array): string {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (isUtf8(bytes)) return bytes.toString();
  let text = '';
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i] ?? 0;
    if (first < 128) {
      text += String.fromCharCode(first);
      i++;
      continue;
    }
    const count =
      first >= 0xc2 && first <= 0xdf
        ? 2
        : first >= 0xe0 && first <= 0xef
          ? 3
          : first >= 0xf0 && first <= 0xf4
            ? 4
            : 0;
    const second = bytes[i + 1] ?? 0;
    let valid =
      count > 0 &&
      i + count <= bytes.length &&
      !(
        (first === 0xe0 && second < 0xa0) ||
        (first === 0xed && second >= 0xa0) ||
        (first === 0xf0 && second < 0x90) ||
        (first === 0xf4 && second >= 0x90)
      );
    for (let j = 1; j < count; j++) if (((bytes[i + j] ?? 0) & 0xc0) !== 0x80) valid = false;
    if (!valid) {
      text += '\uFFFD';
      i++;
      continue;
    }
    let point = first & ((1 << (7 - count)) - 1);
    for (let j = 1; j < count; j++) point = (point << 6) | ((bytes[i + j] ?? 0) & 63);
    text += String.fromCodePoint(point);
    i += count;
  }
  return text;
}
export function normalizeCRLF(input: Uint8Array): Buffer {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength),
    parts: Buffer[] = [];
  let start = 0,
    next = bytes.indexOf('\r\n');
  if (next < 0) return bytes;
  while (next >= 0) {
    parts.push(bytes.subarray(start, next), Buffer.from('\n'));
    start = next + 2;
    next = bytes.indexOf('\r\n', start);
  }
  parts.push(bytes.subarray(start));
  return Buffer.concat(parts);
}
