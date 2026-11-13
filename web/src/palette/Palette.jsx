import { For, onCleanup, onMount, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { createShortcut } from '../lib/shortcuts.jsx';
import { Dialog } from '../lib/Dialog.jsx';
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
      title={MODES[palette.query().mode].label}
      onClose={() => editor.actions.closePalette()}
    >
      <div id="palette" class="w-[min(40rem,calc(100vw-5rem))]">
        <input
          ref={input}
          id="pal"
          class="input w-full"
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
        <Show when={palette.error()}>
          <p role="alert">{palette.error().message}</p>
        </Show>
        <div ref={list} id="pal-list" class="relative max-h-[50vh] overflow-auto" role="menu">
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
            <p class="p-2">{palette.loading() ? 'Searching…' : 'No matches'}</p>
          </Show>
        </div>
        <p id="pal-hint" class="p-2 text-xs text-muted-foreground">
          {MODES[palette.query().mode].hint}
        </p>
      </div>
    </Dialog>
  );
}
