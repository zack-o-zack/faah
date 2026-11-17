import { scrollToItem } from '../lib/list.ts';
import { errorMessage } from '../lib/decode.ts';
import type { JSX } from 'solid-js';
import { For, onCleanup, onMount, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { createShortcut, Kbd } from '../lib/shortcuts.tsx';
import { Dialog } from '../lib/Dialog.tsx';
import { PaletteItem } from './PaletteItem.tsx';
import { MODES, paletteHint } from './logic.ts';
import { PALETTE_HELP } from '../shortcuts/help.ts';
export function Palette(): JSX.Element {
  const editor = useEditor();
  createShortcut('Mod+p', () => editor.actions.openPalette('file'), {
    capture: true,
    inputs: true,
    stopPropagation: true,
  });
  createShortcut('Mod+Shift+p', () => editor.actions.openPalette('command'), {
    capture: true,
    inputs: true,
    stopPropagation: true,
  });
  onCleanup(editor.shortcuts.describe(PALETTE_HELP));
  return (
    <Show when={editor.palette.state.open}>
      <PaletteDialog />
    </Show>
  );
}
function PaletteDialog(): JSX.Element {
  const editor = useEditor();
  const palette = editor.palette;
  let input: HTMLInputElement | undefined;
  let list: HTMLDivElement | undefined;
  onMount(() => {
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
  function move(delta: number) {
    editor.actions.movePalette(delta);
    if (!list) return;
    const row = list.querySelector<HTMLElement>(`[data-i="${palette.state.selected}"]`);
    if (row)
      list.scrollTop = scrollToItem(
        list.scrollTop,
        list.clientHeight,
        row.offsetTop - list.offsetTop,
        row.offsetHeight,
      );
  }
  function key(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n')) move(1);
    else if (event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p')) move(-1);
    else if (event.key === 'Tab') move(event.shiftKey ? -1 : 1);
    else if (event.key === 'Enter') void editor.actions.acceptPalette();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }
  return (
    <Dialog
      open
      bare
      id="overlay"
      dialogClass="command-dialog sm:max-w-[620px]!"
      title={MODES[palette.query().mode].label}
      onClose={() => editor.actions.closePalette()}
    >
      <div
        id="palette"
        class="command max-h-[min(640px,calc(66.667dvh-1rem))]! w-[min(620px,calc(100vw-2rem))]! max-w-none! p-0! [--radius-xl:16px] [&_.kbd]:rounded-[5px] [&_.kbd]:text-[11px] [&_.kbd]:[--kbd-padding:4px] [&_.kbd]:[--kbd-size:18px]"
      >
        <header class="m-0! h-auto! shrink-0 gap-2.5! rounded-none! border-x-0! border-t-0! border-b border-border! bg-transparent! px-4! py-3.5!">
          <span
            class={`${MODES[palette.query().mode].icon} h-5! w-5! shrink-0 text-muted-foreground`}
            role="img"
            aria-label={MODES[palette.query().mode].label}
          />
          <input
            ref={input}
            id="pal"
            class="min-w-0 p-0! text-[19px]! outline-none! ring-0!"
            aria-label="Search commands and files"
            autocomplete="off"
            spellcheck={false}
            placeholder={MODES[palette.query().mode].placeholder}
            value={palette.state.query}
            onInput={(event) => {
              editor.actions.setPaletteQuery(event.currentTarget.value);
              if (list) list.scrollTop = 0;
            }}
            onKeyDown={key}
          />
        </header>
        <Show when={palette.error()}>
          <p role="alert">{errorMessage(palette.error())}</p>
        </Show>
        <div
          ref={list}
          id="pal-list"
          role="menu"
          data-empty=""
          class="min-h-0 max-h-[min(480px,calc(100dvh-12rem))]! p-0!"
        >
          <For each={palette.sections()}>
            {(section) => (
              <div
                role={section.label ? 'group' : undefined}
                aria-label={section.label}
                class="p-0!"
              >
                <Show when={section.label}>
                  <div
                    role="presentation"
                    class="px-4 pt-2.5 pb-1 text-[11px] font-semibold text-muted-foreground"
                  >
                    {section.label}
                  </div>
                </Show>
                <div class="px-1.5 pb-1">
                  <For each={section.entries}>
                    {(entry) => (
                      <PaletteItem
                        item={entry.item}
                        index={entry.index}
                        selected={entry.index === palette.state.selected}
                        onChoose={() => void editor.actions.acceptPalette(entry.index)}
                      />
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
          <Show when={!palette.items().length}>
            <div class="px-3 py-2">
              <span class="truncate">{palette.loading() ? 'Searching…' : 'No matches'}</span>
            </div>
          </Show>
        </div>
        <footer class="flex shrink-0 flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-border bg-muted px-4 py-2 text-xs text-muted-foreground">
          <span class="inline-flex items-center gap-1.5">
            <Kbd combo="Up" />
            <Kbd combo="Down" /> Move
          </span>
          <span class="inline-flex items-center gap-1.5">
            <Kbd combo="Enter" /> Open
          </span>
          <span class="ml-auto">{paletteHint(palette.query().mode, palette.query().query)}</span>
        </footer>
      </div>
    </Dialog>
  );
}
