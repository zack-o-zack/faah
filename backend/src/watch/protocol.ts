import { parse, number, string, record } from '../decode.ts';
import type { WatchEvent } from './service.ts';

export function request(line: string): {
  id: number;
  root: string;
  type: 'subscribe' | 'unsubscribe';
} {
  const value = parse(line);
  if (value.type !== 'subscribe' && value.type !== 'unsubscribe')
    throw new Error('invalid watcher request');
  return { id: number(value.id), root: string(value.root), type: value.type };
}
export function reply(line: string): { id: number; events?: WatchEvent[]; error?: string } {
  const value = parse(line),
    id = number(value.id);
  if (typeof value.error === 'string') return { id, error: value.error };
  if (value.events === undefined) return { id };
  if (!Array.isArray(value.events)) throw new Error('invalid watcher events');
  return {
    id,
    events: value.events.map((entry) => {
      const event = record(entry),
        type = event.type;
      if (type !== undefined && type !== 'create' && type !== 'update' && type !== 'delete')
        throw new Error('invalid watcher event type');
      return { path: string(event.path), ...(type ? { type } : {}) };
    }),
  };
}
