import type { PaletteItem as Item } from './types.ts';

interface PaletteItemProps {
  item: Item;
  index: number;
  selected: boolean;
  onChoose: () => void;
}
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { itemHint, itemIcon, itemParts } from './logic.ts';
import { fileIcon } from '../lib/file-icon.ts';
import { Kbd } from '../lib/shortcuts.tsx';
export function PaletteItem(props: PaletteItemProps): JSX.Element {
  const isFile = () => props.item.kind === 'file' || props.item.kind === 'open-file';
  const icon = () => (isFile() ? fileIcon(props.item.label) : itemIcon(props.item));
  const keys = () => (props.item.kind === 'jump' ? props.item.keys : undefined);
  return (
    <div
      role="menuitem"
      class="gap-2.5! rounded-[9px]! px-2.5! py-[7px]! text-[13px]! whitespace-nowrap! hover:bg-(--hover)! data-[selected=true]:bg-(--hover)! data-[selected=true]:text-foreground!"
      classList={{ active: props.selected }}
      data-selected={props.selected}
      data-i={props.index}
      onClick={() => props.onChoose()}
    >
      <Show when={icon()}>
        <span class={`${icon()} shrink-0 text-muted-foreground`} aria-hidden="true" />
      </Show>
      <span class="flex min-w-0 flex-1 items-center gap-2.5">
        <span class="max-w-full shrink-0 truncate">
          <For each={itemParts(props.item)}>
            {(part) => (
              <Show when={part.bold} fallback={part.text}>
                <b>{part.text}</b>
              </Show>
            )}
          </For>
        </span>
        <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {itemHint(props.item)}
        </span>
      </span>
      <Show when={keys()}>{(combo) => <Kbd combo={combo()} menu />}</Show>
      <Show when={isFile() && props.selected}>
        <span class="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          Open <Kbd combo="Enter" />
        </span>
      </Show>
    </div>
  );
}
