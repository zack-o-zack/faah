import { RenderDisk } from './disk.ts';
import { record, string, number } from '../decode.ts';
let disk: RenderDisk | undefined;
self.onmessage = (event: MessageEvent<unknown>) => {
  const v = record(event.data);
  if (v.type === 'init') {
    disk = new RenderDisk(string(v.path), number(v.budget));
    return;
  }
  const id = number(v.id),
    started = performance.now();
  try {
    if (!disk) throw new Error('cache Worker not initialized');
    if (v.type === 'put') {
      if (!Array.isArray(v.lines)) throw new Error('invalid cached lines');
      disk.put(
        string(v.key),
        string(v.path),
        v.lines.map((v) => string(v)),
      );
    } else if (v.type === 'touch') disk.touch(string(v.key), string(v.path));
    else if (v.type === 'invalidate') disk.invalidate(string(v.path));
    else if (v.type === 'close') disk.close();
    self.postMessage({ id });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
  if (process.env.FAAH_RENDER_PROFILE)
    process.stderr.write(
      JSON.stringify({ type: 'cache-write', ms: performance.now() - started }) + '\n',
    );
};
