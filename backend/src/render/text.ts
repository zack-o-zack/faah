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
