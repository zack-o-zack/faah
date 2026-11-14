import { record, string, number } from '../decode.ts';
import { strings } from './protocol.ts';
import { newItem, find, type Item } from './score.ts';
let items: Item[] = [];
self.onmessage = (event: MessageEvent<unknown>) => {
  const message = record(event.data);
  const id = number(message.id);
  if (message.type === 'set') {
    items = strings(message.paths).map((path) => newItem(path));
    self.postMessage({ id, results: [] });
  } else if (message.type === 'find')
    self.postMessage({ id, results: find(items, string(message.query), number(message.limit)) });
  else throw new Error('unknown fuzzy message');
};
