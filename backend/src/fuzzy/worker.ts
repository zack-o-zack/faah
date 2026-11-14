import { record, string, number } from '../decode.ts';
import { strings } from './protocol.ts';
import { newItem, select, prepareQuery, type Item } from './score.ts';
let items: Item[] = [];
self.onmessage = (event: MessageEvent<unknown>) => {
  const message = record(event.data);
  const id = number(message.id);
  if (message.type === 'set') {
    items = strings(message.paths).map((path) => newItem(path));
    self.postMessage({ id, candidates: new Int32Array(0) });
  } else if (message.type === 'find') {
    const selected = select(items, prepareQuery(string(message.query)), number(message.limit));
    const candidates = new Int32Array(selected.length * 2);
    for (const [i, result] of selected.entries()) {
      candidates[i * 2] = result.index;
      candidates[i * 2 + 1] = result.score;
    }
    self.postMessage({ id, candidates }, [candidates.buffer]);
  } else throw new Error('unknown fuzzy message');
};
