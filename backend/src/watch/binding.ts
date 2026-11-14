import { load } from './native-binding.js';
import { record } from '../decode.ts';
import type { WatchEvent } from './service.ts';
export type Callback = (error: Error | null, events: WatchEvent[]) => void;

export async function subscribe(root: string, callback: Callback): Promise<() => Promise<void>> {
  const value: unknown = load();
  const native = record(value),
    subscribe = native.subscribe,
    unsubscribe = native.unsubscribe;
  if (typeof subscribe !== 'function' || typeof unsubscribe !== 'function')
    throw new Error('invalid watcher native binding');
  const options = process.platform === 'linux' ? { backend: 'inotify' } : {};
  await subscribe(root, callback, options);
  return async () => {
    await unsubscribe(root, callback, options);
  };
}
