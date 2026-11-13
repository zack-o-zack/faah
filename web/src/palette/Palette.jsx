import { For, onCleanup, onMount, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { createShortcut } from '../lib/shortcuts.tsx';
import { Dialog } from '../lib/Dialog.tsx';
import { PaletteItem } from './PaletteItem.jsx';
import { MODES, scrollToItem } from './logic.ts';
import { PALETTE_HELP } from '../shortcuts/help.ts';
export function Palette() {
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
function PaletteDialog() {
  const editor = useEditor();
  const palette = editor.palette;
  let input, list;
  onMount(() => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
  function move(delta) {
    editor.actions.movePalette(delta);
    const row = list.querySelector(`[data-i="${palette.state.selected}"]`);
    if (row)
      list.scrollTop = scrollToItem(
        list.scrollTop,
        list.clientHeight,
        row.offsetTop - list.offsetTop,
        row.offsetHeight,
      );
  }
  function key(event) {
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
      dialogClass="command-dialog sm:max-w-[40rem]!"
      title={MODES[palette.query().mode].label}
      onClose={() => editor.actions.closePalette()}
    >
      <div id="palette" class="command w-[min(40rem,calc(100vw-2rem))]! max-w-none!">
        <header>
          <span id="pal-mode" class="badge" data-variant="secondary">
            {MODES[palette.query().mode].label}
          </span>
          <input
            ref={input}
            id="pal"
            class="min-w-0"
            aria-label="Search commands and files"
            autocomplete="off"
            spellcheck={false}
            placeholder={MODES[palette.query().mode].placeholder}
            value={palette.state.query}
            onInput={(event) => {
              editor.actions.setPaletteQuery(event.currentTarget.value);
              list.scrollTop = 0;
            }}
            onKeyDown={key}
          />
        </header>
        <Show when={palette.error()}>
          <p role="alert">{palette.error().message}</p>
        </Show>
        <div ref={list} id="pal-list" role="menu">
          <For each={palette.items()}>
            {(item, index) => (
              <PaletteItem
                item={item}
                index={index()}
                selected={index() === palette.state.selected}
                onChoose={() => void editor.actions.acceptPalette(index())}
              />
            )}
          </For>
          <Show when={!palette.items().length}>
            <div class="px-3 py-2">
              <span class="truncate">{palette.loading() ? 'Searching…' : 'No matches'}</span>
            </div>
          </Show>
        </div>
        <div
          id="pal-hint"
          class="border-t border-border px-3 py-2 text-xs text-muted-foreground empty:hidden"
        >
          {MODES[palette.query().mode].hint}
        </div>
      </div>
    </Dialog>
  );
}
