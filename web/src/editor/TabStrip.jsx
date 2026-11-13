import { Portal } from 'solid-js/web';
import { createEffect, createSignal, For, Index, onCleanup, Show } from 'solid-js';
import { useEditor } from './context.tsx';
import { createMenuEvents } from '../lib/menu-events.ts';

export function TabStrip(props) {
  const editor = useEditor();
  const [menu, setMenu] = createSignal(null);
  let panel;
  let dragging;
  createMenuEvents({
    open: () => !!menu(),
    panel: () => panel,
    close: () => setMenu(null),
    dismiss: () => setMenu(null),
    roving: () => true,
  });
  createEffect(() => {
    if (!menu()) return;
    const previous = document.activeElement;
    onCleanup(() => previous?.isConnected && previous.focus());
  });
  function action(name) {
    const index = menu().index;
    const tabs = editor.store.state.documents.tabs;
    const indices = tabs
      .map((_, at) => at)
      .filter((at) => {
        if (name === 'all') return true;
        if (name === 'others') return at !== index;
        if (name === 'right') return at > index;
        if (name === 'left') return at < index;
        return at === index;
      });
    setMenu(null);
    editor.actions.closeTabs(indices);
  }
  return (
    <div
      id="tab-row"
      class="flex shrink-0 items-center border-b bg-sidebar has-[#tabs:empty]:hidden"
      hidden={!editor.store.state.documents.tabs.length}
    >
      <div
        id="tabs"
        class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden p-1 [scrollbar-width:none]"
      >
        <For each={editor.store.state.documents.tabs}>
          {(tab, index) => (
            <div
              class="tab flex shrink-0 max-w-64 cursor-pointer select-none items-center gap-2 rounded px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground [&.active]:bg-accent [&.active]:text-foreground [&.tab-deleted_.tn]:line-through"
              classList={{
                active: index() === editor.store.state.documents.active,
                'tab-dirty': tab.dirty,
                'tab-image': tab.isImage,
                'tab-deleted': tab.deleted,
              }}
              data-i={index()}
              draggable="true"
              onDragStart={() => {
                dragging = index();
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (Number.isInteger(dragging)) editor.actions.moveDocument(dragging, index());
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ index: index(), x: event.clientX, y: event.clientY });
              }}
              onAuxClick={(event) => {
                if (event.button === 1) editor.actions.closeTabs([index()]);
              }}
            >
              <Show when={tab.isImage}>
                <span
                  class="icon-[lucide--image] size-3 shrink-0 tab-icon text-primary"
                  aria-hidden="true"
                />
              </Show>
              <button
                class="tn min-h-6 min-w-6 truncate text-left focus-visible:outline focus-visible:outline-ring"
                aria-pressed={index() === editor.store.state.documents.active}
                onClick={() => editor.actions.switchTab(index())}
              >
                {tab.name}
              </button>
              <Show when={tab.dirty}>
                <span
                  class="tab-dirty-dot size-2 shrink-0 rounded-full bg-primary"
                  title="Unsaved changes"
                />
              </Show>
              <Show when={tab.diffRef}>
                <span class="tab-ref shrink-0 font-mono text-xs text-muted-foreground">
                  @{tab.diffRef?.slice(0, 7)}
                </span>
              </Show>
              <button
                class="btn"
                data-variant="ghost"
                data-size="icon-xs"
                aria-label="Close tab"
                onClick={() => editor.actions.closeTabs([index()])}
              >
                <span class="icon-[lucide--x] size-3.5" />
              </button>
            </div>
          )}
        </For>
      </div>
      {props.children}
      <Show when={menu()}>
        <Portal>
          <div
            id="tab-menu"
            role="menu"
            ref={panel}
            data-popover
            aria-hidden="false"
            class="fixed min-w-[190px] max-w-[min(380px,95vw)] z-[70] top-auto left-auto m-0 gap-0"
            style={{ left: `${menu().x}px`, top: `${menu().y}px` }}
          >
            <Index each={['close', 'all', 'others', 'right', 'left']}>
              {(name) => (
                <button
                  role="menuitem"
                  data-tab-action={name()}
                  class="w-full justify-start"
                  data-control="sel-menu-item"
                  data-variant="ghost"
                  data-size="xs"
                  disabled={
                    (name() === 'others' && editor.store.state.documents.tabs.length < 2) ||
                    (name() === 'left' && menu().index === 0) ||
                    (name() === 'right' &&
                      menu().index === editor.store.state.documents.tabs.length - 1)
                  }
                  onClick={() => action(name())}
                >
                  {
                    {
                      close: 'Close',
                      all: 'Close All',
                      others: 'Close Others',
                      right: 'Close to the Right',
                      left: 'Close to the Left',
                    }[name()]
                  }
                </button>
              )}
            </Index>
          </div>
        </Portal>
      </Show>
    </div>
  );
}
