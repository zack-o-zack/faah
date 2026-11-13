import { For, Show } from 'solid-js';
import { fuzzyParts } from './logic.ts';
export function PaletteItem(props) {
  const positions = () =>
    props.item.kind === 'file'
      ? props.item.positions
          .filter((position) => position >= props.item.path.length - props.item.label.length)
          .map((position) => position - props.item.path.length + props.item.label.length)
      : [];
  return (
    <button
      role="menuitem"
      class="flex w-full min-w-0 items-center gap-2 p-2 text-left text-sm hover:bg-accent data-[selected=true]:bg-accent"
      data-selected={props.selected}
      data-i={props.index}
      onClick={() => props.onChoose()}
    >
      <span class="min-w-0 flex-1 truncate">
        <For each={fuzzyParts(props.item.label, positions())}>
          {(part) => (
            <Show when={part.bold} fallback={part.text}>
              <b>{part.text}</b>
            </Show>
          )}
        </For>
      </span>
      <span class="max-w-[40%] truncate text-xs text-muted-foreground">{props.item.sub}</span>
    </button>
  );
}
