import type { DirectoryEntry } from './decode.ts';

interface BrowseToolbarProps {
  selected?: DirectoryEntry;
  onMkdir: () => void;
  onOpen: () => void;
}
import type { JSX } from 'solid-js';
import { For } from 'solid-js';
import { useWorkbench } from './context.tsx';
import { breadcrumbs } from './logic.ts';
export function BrowseToolbar(props: BrowseToolbarProps): JSX.Element {
  const { state, actions } = useWorkbench();
  return (
    <div class="flex flex-wrap items-center gap-2 border-b p-2">
      <button
        class="btn"
        aria-label="Back to the parent folder"
        disabled={!state.directory.parent}
        onClick={() => actions.browse(state.directory.parent)}
      >
        Up
      </button>
      <nav class="flex min-w-0 flex-1 overflow-auto" aria-label="Folder path">
        <For each={breadcrumbs(state.directory.path, state.home, state.sep)}>
          {(crumb) => (
            <button
              class="btn shrink-0"
              data-variant="ghost"
              onClick={() => actions.browse(crumb.path)}
            >
              {crumb.name}
            </button>
          )}
        </For>
      </nav>
      <button class="btn" aria-label="New folder" onClick={() => props.onMkdir()}>
        <span class="icon-[lucide--folder-plus] size-4" />
      </button>
      <button
        class="btn"
        aria-label="Show hidden folders"
        aria-pressed={state.hidden}
        onClick={actions.toggleHidden}
      >
        <span class="icon-[lucide--eye] size-4" />
      </button>
      <button class="btn" data-variant="secondary" onClick={() => props.onOpen()}>
        {state.clone ? 'Use' : 'Open'} {props.selected?.name || 'this folder'}
      </button>
    </div>
  );
}
