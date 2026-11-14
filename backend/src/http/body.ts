/**
 * Read at most `cap` bytes of a request body, like Go's io.LimitReader: the
 * rest is discarded, not rejected.
 */
export async function readCapped(request: Request, cap: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < cap) {
      const part = await reader.read();
      if (part.done) break;
      const data = part.value.subarray(0, cap - size);
      chunks.push(data);
      size += data.length;
    }
    return Buffer.concat(chunks, size);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
