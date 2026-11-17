import type { PaletteItem as Item } from './types.ts';

interface PaletteItemProps {
  item: Item;
  index: number;
  selected: boolean;
  onChoose: () => void;
}
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { fuzzyParts } from './logic.ts';
import { fileIcon } from '../lib/file-icon.ts';
export function PaletteItem(props: PaletteItemProps): JSX.Element {
  const positions = () => {
    const item = props.item;
    return item.kind === 'file'
      ? item.positions
          .filter((position) => position >= item.path.length - item.label.length)
          .map((position) => position - item.path.length + item.label.length)
      : [];
  };
  return (
    <div
      role="menuitem"
      class="whitespace-normal! data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground [&_b]:text-primary-text"
      classList={{ active: props.selected }}
      data-selected={props.selected}
      data-i={props.index}
      onClick={() => props.onChoose()}
    >
      <Show when={props.item.kind === 'file'}>
        <span
          class={`${fileIcon(props.item.label)} shrink-0 text-muted-foreground`}
          aria-hidden="true"
        />
      </Show>
      <span class="min-w-0 flex-1 whitespace-normal! wrap-anywhere">
        <For each={fuzzyParts(props.item.label, positions())}>
          {(part) => (
            <Show when={part.bold} fallback={part.text}>
              <b>{part.text}</b>
            </Show>
          )}
        </For>
      </span>
      <span class="max-w-[35%] truncate">{'sub' in props.item ? props.item.sub : undefined}</span>
    </div>
  );
}
