import type { DirectoryEntry } from './decode.ts';

interface PathSuggestionsProps {
  id: string;
  entries?: DirectoryEntry[];
  selected: number;
  onAccept: (index: number) => void;
}
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { Kbd } from '../lib/shortcuts.tsx';
import { useWorkbench } from './context.tsx';
import { parentFolder } from './logic.ts';
export function PathSuggestions(props: PathSuggestionsProps): JSX.Element {
  const { state } = useWorkbench();
  return (
    <div
      data-popover
      class="path-suggestions absolute inset-x-0 top-full z-50 mt-1.5 block max-h-80 overflow-auto rounded-[14px] p-0"
    >
      <ul id={props.id} role="listbox" class="p-1">
        <For each={props.entries}>
          {(entry, index) => (
            <li
              id={`${props.id}-${index()}`}
              role="option"
              aria-selected={index() === props.selected}
              class="flex h-8 min-w-0 cursor-pointer items-center gap-2.5 rounded-[9px] px-2.5 text-[13px] whitespace-nowrap text-foreground hover:bg-(--hover) aria-selected:bg-(--hover)"
              onMouseDown={(e) => {
                e.preventDefault();
                props.onAccept(index());
              }}
            >
              <span
                aria-hidden="true"
                class={`h-4 w-4 shrink-0 text-muted-foreground ${entry.git ? 'icon-[ph--git-branch]' : 'icon-[ph--folder]'}`}
              />
              <span class="max-w-1/2 shrink-0 truncate">{entry.name}</span>
              <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {parentFolder(entry.path, state.home, state.sep)}
              </span>
              <Show when={index() === props.selected}>
                <span class="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <Kbd combo="Tab" /> inside
                  <span class="ml-1.5">Open</span> <Kbd combo="Enter" />
                </span>
              </Show>
            </li>
          )}
        </For>
      </ul>
      <footer class="flex items-center gap-3.5 border-t px-3.5 py-[7px] text-xs whitespace-nowrap text-muted-foreground">
        <span class="inline-flex items-center gap-1.5">
          <Kbd combo="Up+Down" /> Move
        </span>
        <span class="inline-flex items-center gap-1.5">
          <Kbd combo="Tab" /> Go inside
        </span>
        <span class="inline-flex items-center gap-1.5">
          <Kbd combo="Enter" /> Open
        </span>
      </footer>
    </div>
  );
}
