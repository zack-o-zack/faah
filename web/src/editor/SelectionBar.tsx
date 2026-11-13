import type { SelectionInfo } from './selection.ts';
type MenuItem = (typeof SEL_MENU_ITEMS)[number];
import type { JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { useEditor } from './context.tsx';
import { SEL_MENU_ITEMS } from './selection.ts';
import { Kbd } from '../lib/shortcuts.tsx';
import { createMenuEvents } from '../lib/menu-events.ts';

export function SelectionBar(): JSX.Element {
  const editor = useEditor();
  const [copied, setCopied] = createSignal('');
  let panel: HTMLDivElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  onMount(() => {
    editor.services.selection = {
      copied(action) {
        setCopied(action);
        clearTimeout(timer);
        timer = setTimeout(() => setCopied(''), 1200);
      },
    };
    onCleanup(() => delete editor.services.selection);
  });
  createMenuEvents({
    open: () => !!editor.ui.menu,
    panel: () => panel,
    close: editor.actions.closeSelectionMenu,
    dismiss: editor.actions.closeSelectionMenu,
    roving: () => true,
  });
  function items(info: SelectionInfo | null | undefined) {
    return SEL_MENU_ITEMS.filter((item) => {
      if (item.sel === 'review-comment' && !editor.pr.available()) return false;
      if (item.sel === 'explain' && (info?.isMarkdownPreview || (info?.text.length || 0) > 12000))
        return false;
      return info?.isMarkdownPreview ? !item.forCode : !item.forPreview;
    });
  }
  const footerItems = () =>
    [
      'copy-source',
      'copy-preview-text',
      'copy-markdown',
      'copy-ref',
      'copy-agent',
      'thread',
      'explain',
      'agent-edit',
    ]
      .map((action) => items(editor.ui.selection).find((item) => item.sel === action))
      .filter((item): item is MenuItem => item !== undefined);
  function label(item: MenuItem) {
    if (copied() === item.sel) return 'Copied';
    const labels: Record<string, string> = { thread: 'Thread', 'copy-preview-text': 'Copy Text' };
    return labels[item.sel] || item.label;
  }
  function run(action: string) {
    const info = editor.ui.menu?.info || editor.ui.selection;
    editor.actions.closeSelectionMenu();
    editor.actions.runSelectionAction(action, info);
  }
  return (
    <>
      <div
        id="footer-sel"
        class="hidden min-w-0 items-center gap-2 [#status.selecting_&]:flex"
        hidden={!editor.ui.selection}
        onMouseDown={(event) => event.preventDefault()}
      >
        <span class="sel-chip badge">Selection</span>
        <Show when={editor.ui.selection}>
          <For each={footerItems()}>
            {(item) => (
              <button
                class="btn"
                data-control="bar-action"
                data-variant="ghost"
                data-size="xs"
                classList={{
                  'text-gi!': copied() === item.sel,
                  'border-gi!': copied() === item.sel,
                }}
                data-sel={item.sel}
                onClick={() => run(item.sel)}
              >
                <span class="bar-action-label text-xs font-medium desktop:hidden">
                  {label(item)}
                </span>
                <Kbd
                  combo={item.keys}
                  class="kbd desktop:hidden has-[>kbd]:bg-transparent has-[>kbd]:p-0 has-[>kbd]:gap-1"
                />
              </button>
            )}
          </For>
        </Show>
      </div>
      <Show when={editor.ui.menu}>
        <Portal>
          <div class="dropdown-menu contents">
            <div
              id="sel-menu"
              ref={panel}
              data-popover
              aria-hidden="false"
              role="menu"
              class="fixed min-w-[190px] max-w-[min(380px,95vw)] z-[70] top-auto left-auto m-0 gap-0"
              style={{ left: `${editor.ui.menu?.x}px`, top: `${editor.ui.menu?.y}px` }}
              onMouseDown={(event) => event.preventDefault()}
            >
              <For each={items(editor.ui.menu?.info)}>
                {(item) => (
                  <button
                    class="w-full justify-start"
                    data-control="sel-menu-item"
                    data-variant="ghost"
                    data-size="xs"
                    role="menuitem"
                    data-sel={item.sel}
                    onClick={() => run(item.sel)}
                  >
                    <span>{item.label}</span>
                    <Kbd combo={item.keys} />
                  </button>
                )}
              </For>
            </div>
          </div>
        </Portal>
      </Show>
    </>
  );
}
