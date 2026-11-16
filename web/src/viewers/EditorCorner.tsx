import type { JSX } from 'solid-js';
import { ExplainOrb } from './ExplainOrb.tsx';

/** The explanation shares one corner across the source and review surfaces. */
export function EditorCorner(): JSX.Element {
  return (
    <div
      data-ui="editor-corner"
      class="pointer-events-none absolute top-2 right-2 z-20 flex max-w-[calc(100%_-_16px)] flex-col items-end gap-2 *:pointer-events-auto"
    >
      <ExplainOrb />
    </div>
  );
}
