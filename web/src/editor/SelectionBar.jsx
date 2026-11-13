import { Portal } from 'solid-js/web';
import { For, Show } from 'solid-js';
import { useEditor } from './context.jsx';
import { SEL_MENU_ITEMS } from './selection.js';
import { Kbd } from '../lib/shortcuts.jsx';
import { createMenuEvents } from '../lib/menu-events.js';

export function SelectionBar() {
  const editor = useEditor();
  let panel;
  createMenuEvents({
    open: () => !!editor.ui.menu,
    panel: () => panel,
    close: editor.actions.closeSelectionMenu,
    dismiss: editor.actions.closeSelectionMenu,
    roving: () => true,
  });
  function items(info) {
    return SEL_MENU_ITEMS.filter((item) => {
      if (item.sel === 'review-comment' && !editor.pr.available()) return false;
      return info?.isMarkdownPreview ? !item.forCode : !item.forPreview;
    });
  }
  function run(action, event) {
    const info = editor.ui.menu?.info || editor.ui.selection;
    editor.actions.closeSelectionMenu();
    editor.actions.runSelectionAction(action, event.currentTarget, info);
  }
  return (
    <>
      <div
        id="footer-sel"
        class="flex min-w-0 items-center gap-2"
        hidden={!editor.ui.selection}
        onMouseDown={(event) => event.preventDefault()}
      >
        <Show when={editor.ui.selection}>
          <For each={items(editor.ui.selection)}>
            {(item) => (
              <button class="btn" data-sel={item.sel} onClick={(event) => run(item.sel, event)}>
                {item.label}
                <Kbd combo={item.keys} />
              </button>
            )}
          </For>
          <span id="sel-stats">{editor.ui.selection.l2 - editor.ui.selection.l1 + 1} lines</span>
        </Show>
      </div>
      <Show when={editor.ui.menu}>
        <Portal>
          <div
            id="sel-menu"
            ref={(element) => {
              panel = element;
            }}
            role="menu"
            class="dropdown-menu fixed z-[70] flex w-56 flex-col border bg-popover p-1"
            style={{ left: `${editor.ui.menu.x}px`, top: `${editor.ui.menu.y}px` }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <For each={items(editor.ui.menu?.info)}>
              {(item) => (
                <button
                  class="btn w-full"
                  role="menuitem"
                  data-sel={item.sel}
                  onClick={(event) => run(item.sel, event)}
                >
                  {item.label}
                </button>
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </>
  );
}
