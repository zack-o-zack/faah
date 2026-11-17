interface DirectoryListProps {
  onReady?: (focus: () => void) => void;
  onKeyDown: (event: KeyboardEvent) => void;
}
import type { JSX } from 'solid-js';
import { For, onMount } from 'solid-js';
import { useWorkbench } from './context.tsx';
import { directoryIconClass, directoryRowClass } from './directory-row.ts';
export function DirectoryList(props: DirectoryListProps): JSX.Element {
  const { state, actions } = useWorkbench();
  let list: HTMLUListElement | undefined;
  onMount(() => props.onReady?.(() => list?.focus()));
  return (
    <ul
      ref={list}
      role="listbox"
      tabindex="0"
      aria-label="Folders"
      aria-busy={state.busy}
      aria-activedescendant={state.selected >= 0 ? `folder-${state.selected}` : undefined}
      class="min-h-0 min-w-0 overflow-auto p-1"
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
            class={directoryRowClass}
            classList={{
              'text-muted-foreground': entry.name.startsWith('.'),
              'text-foreground': !entry.name.startsWith('.'),
            }}
            onClick={() => {
              list?.focus();
              actions.selectDirectory(index());
            }}
            onDblClick={() => actions.browse(entry.path)}
          >
            <span
              class={`${directoryIconClass} ${entry.git ? 'icon-[ph--git-branch]' : 'icon-[ph--folder]'}`}
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1 truncate">{entry.name}</span>
            <span
              class="icon-[ph--caret-right] h-3 w-3 shrink-0 text-muted-foreground"
              aria-hidden="true"
              onClick={(event) => {
                event.stopPropagation();
                if (event.detail > 1) return;
                list?.focus();
                actions.browse(entry.path);
              }}
              onDblClick={(event) => event.stopPropagation()}
            />
          </li>
        )}
      </For>
    </ul>
  );
}
