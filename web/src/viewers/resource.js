import { createMemo, createResource, onCleanup } from 'solid-js';
import { api } from '../lib/api.ts';

// Solid drops superseded results; abort also releases the old response and parser work.
export function createViewerResource(editor, document, endpoint) {
  let controller;
  const key = createMemo(
    () => {
      const doc = document();
      editor.store.bufferRevision();
      if (!doc) return false;
      const buffer = editor.store.buffers.get(doc.path);
      buffer?.revision();
      return {
        path: doc.path,
        ref: doc.diffRef || '',
        base: doc.diffBase || '',
        revision: doc.viewerRevision || 0,
        buffer,
        generation: buffer?.generation,
      };
    },
    undefined,
    {
      equals: (a, b) =>
        a?.path === b?.path &&
        a?.ref === b?.ref &&
        a?.base === b?.base &&
        a?.revision === b?.revision &&
        a?.buffer === b?.buffer &&
        a?.generation === b?.generation,
    },
  );
  const [data, controls] = createResource(key, async (key) => {
    controller?.abort();
    controller = new AbortController();
    return api(
      typeof endpoint === 'function' ? endpoint() : endpoint,
      { path: key.path, ref: key.ref, base: key.base },
      { signal: controller.signal },
    );
  });
  onCleanup(() => controller?.abort());
  return [data, controls];
}
