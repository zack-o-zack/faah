import type { JSX } from 'solid-js';
import { For } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { PRComposer } from './PRComposer.tsx';
// Composers for a line that is not on screen dock in the corner until you jump back.
export function ComposerDock(): JSX.Element {
  const editor = useEditor();
  const docked = () => {
    const document = editor.active();
    return editor.pr.state.composers.filter(
      (composer) => !document?.diffMode || document.path !== composer.path,
    );
  };
  return (
    <div class="pointer-events-none fixed right-4 bottom-12 z-30 flex flex-col-reverse items-end gap-2 *:pointer-events-auto">
      <For each={docked()}>{(composer) => <PRComposer composer={composer} />}</For>
    </div>
  );
}
