import { RenderDisk } from './disk.ts';
import { record, string, number } from '../decode.ts';
let disk: RenderDisk | undefined;
self.onmessage = (event: MessageEvent<unknown>) => {
  const message = record(event.data);
  if (message.type === 'init') {
    disk = new RenderDisk(string(message.path), number(message.budget));
    return;
  }
  const id = number(message.id),
    started = performance.now();
  try {
    if (!disk) throw new Error('cache Worker not initialized');
    if (message.type === 'put') {
      if (!Array.isArray(message.lines)) throw new Error('invalid cached lines');
      disk.put(
        string(message.key),
        string(message.path),
        message.lines.map((line) => string(line)),
      );
    } else if (message.type === 'touch') disk.touch(string(message.key), string(message.path));
    else if (message.type === 'invalidate') disk.invalidate(string(message.path));
    else if (message.type === 'close') disk.close();
    self.postMessage({ id });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
  if (process.env.FAAH_RENDER_PROFILE)
    process.stderr.write(
      JSON.stringify({ type: 'cache-write', ms: performance.now() - started }) + '\n',
    );
};
