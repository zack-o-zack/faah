import { load } from './native-binding.js';
import { record } from '../decode.ts';
import type { WatchEvent } from './service.ts';

export type Callback = (error: Error | null, events: WatchEvent[]) => void;

export async function subscribe(root: string, callback: Callback): Promise<() => Promise<void>> {
  const native = nativeBinding();
  const options = process.platform === 'linux' ? { backend: 'inotify' } : {};
  await native.subscribe(root, callback, options);
  return async () => {
    await native.unsubscribe(root, callback, options);
  };
}

type NativeCall = (root: string, callback: Callback, options: object) => Promise<void>;

interface NativeBinding {
  subscribe: NativeCall;
  unsubscribe: NativeCall;
}

function nativeBinding(): NativeBinding {
  const value: unknown = load();
  const native = record(value);
  const { subscribe, unsubscribe } = native;
  if (!isNativeCall(subscribe) || !isNativeCall(unsubscribe))
    throw new Error('invalid watcher native binding');
  return { subscribe, unsubscribe };
}

// The addon is untyped; its two entry points are checked for callability only.
function isNativeCall(value: unknown): value is NativeCall {
  return typeof value === 'function';
}
