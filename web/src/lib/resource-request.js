import { onCleanup } from 'solid-js';
import { api } from './api.js';
// One resource owns one replaceable request, including servers that ignore abort.
export function createResourceRequest(request = api) {
  let controller;
  onCleanup(() => controller?.abort());
  return (path, params) => {
    controller?.abort();
    controller = new AbortController();
    const mine = controller;
    return Promise.resolve(request(path, params, { signal: mine.signal })).then((result) => {
      if (mine.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      return result;
    });
  };
}
