import type { Accessor, ResourceReturn } from 'solid-js';
import type { AppStore } from '../app/store.ts';
import type { DocTab } from '../editor/types.ts';
import type { DocumentBuffer } from '../editor/buffer.ts';
interface ResourceKey {
  path: string;
  ref: string;
  base: string;
  revision: number;
  buffer: Pick<DocumentBuffer, 'revision' | 'generation'> | undefined;
  generation: number | undefined;
}
import { createMemo, createResource, onCleanup } from 'solid-js';
import { api } from '../lib/api.ts';

// Solid drops superseded results; abort also releases the old response and parser work.
export function createViewerResource<T>(
  editor: {
    store: {
      buffers: Map<string, Pick<DocumentBuffer, 'revision' | 'generation'>>;
      bufferRevision: AppStore['bufferRevision'];
    };
  },
  document: Accessor<DocTab | null>,
  endpoint: string | Accessor<string>,
  decode: (value: unknown) => T,
): ResourceReturn<T> {
  let controller: AbortController | undefined;
  const key = createMemo<ResourceKey | undefined>(
    () => {
      const doc = document();
      editor.store.bufferRevision();
      if (!doc) return undefined;
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
    const path = typeof endpoint === 'function' ? endpoint() : endpoint;
    const value = await api(
      path,
      { path: key.path, ref: key.ref, base: key.base },
      { signal: controller.signal },
    );
    return decode(value);
  });
  onCleanup(() => controller?.abort());
  return [data, controls];
}
