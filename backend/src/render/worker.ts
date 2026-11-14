import { engine } from './engine.ts';
import { record, number, string } from '../decode.ts';
const highlight = await engine();
self.onmessage = (event: MessageEvent<unknown>) => {
  const value = record(event.data);
  if (value.type === 'gc') {
    Bun.gc(true);
    return;
  }
  const id = number(value.id);
  void highlight(string(value.source), string(value.lang), number(value.want)).then(
    (lines) => self.postMessage({ id, lines }),
    (error: unknown) => self.postMessage({ id, error: String(error) }),
  );
};
