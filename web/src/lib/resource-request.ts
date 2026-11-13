import { onCleanup } from 'solid-js';
import type { Request, RequestParams } from './api.ts';
import { api } from './api.ts';
// One resource owns one replaceable request, including servers that ignore abort.
export function createResourceRequest(
  request: Request = api,
): (path: string, params?: RequestParams) => Promise<unknown> {
  let controller: AbortController | undefined;
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
