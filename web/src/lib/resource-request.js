import { onCleanup } from 'solid-js';
import { api } from './api.js';
// One resource owns one replaceable request, including servers that ignore abort.
export function createResourceRequest(request = api) {
  let controller;
  onCleanup(() => controller?.abort());
  return (path, params) => {
    controller?.abort();
    controller = new AbortController();
    return request(path, params, { signal: controller.signal });
  };
}
