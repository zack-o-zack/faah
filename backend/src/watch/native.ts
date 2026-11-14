import { load } from './native-binding.js';
import { record } from '../decode.ts';
import type { WatchEvent } from './service.ts';
export type Callback = (error: Error | null, events: WatchEvent[]) => void;
// Bun's source test runner requires Node-API modules through require; the
// generated binding keeps the .node dependency literal for the compiler.
function binding() {
  const value: unknown = load();
  const native = record(value),
    subscribe = native.subscribe,
    unsubscribe = native.unsubscribe;
  if (typeof subscribe !== 'function' || typeof unsubscribe !== 'function')
    throw new Error('invalid watcher native binding');
  return {
    subscribe: async (root: string, callback: Callback) => {
      await subscribe(root, callback, {});
    },
    unsubscribe: async (root: string, callback: Callback) => {
      await unsubscribe(root, callback, {});
    },
  };
}
export async function subscribe(root: string, callback: Callback): Promise<() => Promise<void>> {
  const watcher = binding();
  await watcher.subscribe(root, callback);
  return () => watcher.unsubscribe(root, callback);
}
