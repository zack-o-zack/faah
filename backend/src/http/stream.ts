export function trackStream(
  body: ReadableStream<Uint8Array> | null,
  done: () => void,
): ReadableStream<Uint8Array> | null {
  if (!body) {
    done();
    return null;
  }
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          done();
          controller.close();
        } else controller.enqueue(chunk.value);
      } catch (error) {
        done();
        controller.error(error);
      }
    },
    async cancel(reason: unknown) {
      done();
      await reader.cancel(reason);
    },
  });
}
