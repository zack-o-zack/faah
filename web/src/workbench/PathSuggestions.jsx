import { For } from 'solid-js';
import { useWorkbench } from './context.jsx';
import { tildify } from './logic.js';
export function PathSuggestions(props) {
  const { state } = useWorkbench();
  return (
    <ul
      id={props.id}
      role="listbox"
      data-popover
      class="absolute inset-x-0 top-full z-50 mt-1 max-h-80 overflow-auto"
    >
      <For each={props.entries}>
        {(entry, index) => (
          <li
            id={`${props.id}-${index()}`}
            role="option"
            aria-selected={index() === props.selected}
            class="item cursor-pointer aria-selected:bg-accent"
            onMouseDown={(e) => {
              e.preventDefault();
              props.onAccept(index());
            }}
          >
            <span
              class={
                entry.git
                  ? 'icon-[lucide--folder-git-2] size-4 text-gi'
                  : 'icon-[lucide--folder] size-4'
              }
            />
            <span>{entry.name}</span>
            <span class="truncate text-xs text-muted-foreground">
              {tildify(entry.path, state.home, state.sep)}
            </span>
          </li>
        )}
      </For>
    </ul>
  );
}
