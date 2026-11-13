import type { JSX } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
export function TreeScope(): JSX.Element {
  const editor = useEditor();
  return (
    <div
      id="scope-bar"
      class="border-b p-2"
      hidden={
        !editor.store.state.workspace.meta?.pr ||
        editor.tree.mode() !== 'git' ||
        !editor.tree.counts().yours
      }
    >
      <div class="button-group w-full" role="group" aria-label="Changes to show">
        <button
          class="btn flex-1"
          data-scope="all"
          aria-pressed={editor.tree.scope() === 'all'}
          onClick={() => void editor.actions.setTreeScope('all')}
        >
          PR changes <span id="scope-all-n">{editor.tree.counts().all}</span>
        </button>
        <button
          class="btn flex-1"
          data-scope="yours"
          aria-pressed={editor.tree.scope() === 'yours'}
          onClick={() => void editor.actions.setTreeScope('yours')}
        >
          Not pushed <span id="scope-yours-n">{editor.tree.counts().yours}</span>
        </button>
      </div>
    </div>
  );
}
