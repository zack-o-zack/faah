import { engine } from './engine.ts';
import { record, number, string } from '../decode.ts';
let ready: ReturnType<typeof engine> | undefined;
self.onmessage = (event: MessageEvent<unknown>) => {
  const value = record(event.data);
  if (value.type === 'init') {
    const assets = Object.fromEntries(
      Object.entries(record(value.assets)).map(([id, v]) => [id, string(v)]),
    );
    const groups = Object.fromEntries(
      Object.entries(record(value.groups)).map(([id, v]) => {
        if (!Array.isArray(v)) throw new Error('invalid grammar group');
        return [id, v.map((v) => string(v))];
      }),
    );
    ready = engine({ assets, groups });
    return;
  }
  if (value.type === 'gc') {
    Bun.gc(true);
    return;
  }
  const id = number(value.id);
  const task = (async () => {
    if (!ready) throw new Error('render Worker not initialized');
    const highlight = await ready;
    if (value.type === 'warm') {
      if (!Array.isArray(value.langs)) throw new Error('invalid warm languages');
      await highlight.warm(value.langs.map((v) => string(v)));
      return [];
    }
    return highlight(string(value.source), string(value.lang), number(value.want));
  })();
  void task.then(
    (lines) => self.postMessage({ id, lines }),
    (error: unknown) => self.postMessage({ id, error: String(error) }),
  );
};
