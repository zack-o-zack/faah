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
    <div
      role="menuitem"
      class="whitespace-normal! data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground [&_b]:text-primary-text"
      classList={{ active: props.selected }}
      data-selected={props.selected}
      data-i={props.index}
      onClick={() => props.onChoose()}
    >
      <span class="min-w-0 flex-1 whitespace-normal! wrap-anywhere">
        <For each={fuzzyParts(props.item.label, positions())}>
          {(part) => (
            <Show when={part.bold} fallback={part.text}>
              <b>{part.text}</b>
            </Show>
          )}
        </For>
      </span>
      <span class="max-w-[35%] truncate">{props.item.sub}</span>
      <Show when={props.item.right}>
        <span class="badge ml-auto" data-variant="outline">
          {props.item.right}
        </span>
      </Show>
    </div>
  );
}
