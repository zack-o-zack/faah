import { For, onMount } from 'solid-js';
import { useWorkbench } from './context.jsx';
export function DirectoryList(props) {
  const { state, actions } = useWorkbench();
  let list;
  onMount(() => props.onReady?.(() => list.focus()));
  return (
    <ul
      ref={list}
      role="listbox"
      tabindex="0"
      aria-label="Folders"
      aria-busy={state.busy}
      aria-activedescendant={state.selected >= 0 ? `folder-${state.selected}` : undefined}
      class="min-h-0 flex-1 overflow-auto p-1"
      onKeyDown={(event) => props.onKeyDown(event)}
    >
      <For
        each={state.directory.entries}
        fallback={<li class="p-8 text-muted-foreground">No folders here.</li>}
      >
        {(entry, index) => (
          <li
            id={`folder-${index()}`}
            role="option"
            aria-selected={index() === state.selected}
            class={`flex cursor-pointer items-center gap-2 rounded-md p-2
        hover:bg-accent aria-selected:bg-accent`}
            classList={{ 'opacity-50': entry.name.startsWith('.') }}
            onClick={() => actions.browse(entry.path)}
          >
            <span
              class={
                entry.git
                  ? 'icon-[lucide--folder-git-2] size-4 text-gi'
                  : 'icon-[lucide--folder] size-4'
              }
              aria-hidden="true"
            />
            {entry.name}
          </li>
        )}
      </For>
    </ul>
  );
}
