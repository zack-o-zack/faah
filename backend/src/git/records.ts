import { goString } from '../render/text.ts';

// Split bytes before decoding so UTF-8 spanning pipe reads and invalid bytes
// have the same replacement behavior as Go's JSON encoder.
export async function readRecords(
  stream: ReadableStream<Uint8Array>,
  delimiter: number,
  consume: (record: string) => void,
): Promise<void> {
  let pieces: Uint8Array[] = [];
  let processed = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    let start = 0;
    for (let end = bytes.indexOf(delimiter); end >= 0; end = bytes.indexOf(delimiter, start)) {
      const part = bytes.subarray(start, end);
      consume(goString(pieces.length ? Buffer.concat([...pieces, part]) : part));
      pieces = [];
      start = end + 1;
    }
    if (start < bytes.length) pieces.push(bytes.subarray(start));
    // Large status/history output must not monopolize the HTTP event loop.
    processed += bytes.length;
    if (processed >= 64 << 10) {
      processed = 0;
      await Bun.sleep(0);
    }
  }
  consume(pieces.length ? goString(Buffer.concat(pieces)) : '');
}
