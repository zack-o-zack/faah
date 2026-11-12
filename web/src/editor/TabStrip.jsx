import { createEffect, createSignal, For, Index, onCleanup, Show } from 'solid-js';
import { useEditor } from './context.jsx';
import { createMenuEvents } from '../lib/menu-events.js';

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
    queueMicrotask(() => panel?.querySelector('button')?.focus());
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
      class="flex shrink-0 items-center border-b bg-sidebar"
      hidden={!editor.store.state.documents.tabs.length}
    >
      <div
        id="tabs"
        class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden p-1"
      >
        <For each={editor.store.state.documents.tabs}>
          {(tab, index) => (
            <div
              class="tab flex max-w-64 shrink-0 items-center gap-2 rounded px-3 py-1 text-xs"
              classList={{
                active: index() === editor.store.state.documents.active,
                'tab-dirty': tab.dirty,
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
              <button
                class="tn truncate"
                aria-pressed={index() === editor.store.state.documents.active}
                onClick={() => editor.actions.switchTab(index())}
              >
                {tab.name}
              </button>
              <Show when={tab.dirty}>
                <span
                  class="tab-dirty-dot size-2 rounded-full bg-primary"
                  title="Unsaved changes"
                />
              </Show>
              <Show when={tab.diffRef}>
                <span class="tab-ref">@{tab.diffRef?.slice(0, 7)}</span>
              </Show>
              <button
                class="btn"
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
        <div
          id="tab-menu"
          ref={panel}
          role="menu"
          class="dropdown-menu fixed z-50 border bg-popover p-1"
          style={{ left: `${menu().x}px`, top: `${menu().y}px` }}
        >
          <Index each={['close', 'all', 'others', 'right', 'left']}>
            {(name) => (
              <button role="menuitem" class="btn w-full" onClick={() => action(name())}>
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
      </Show>
    </div>
  );
}
