import { For } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
export function InspectorToolbar() {
  const editor = useEditor();
  const tabs = [
    ['refs', 'References'],
    ['symbols', 'Symbols'],
    ['calls', 'Calls'],
    ['search', 'Search'],
  ];
  return (
    <header class="flex shrink-0 items-center justify-between border-b p-2">
      <div role="tablist" aria-label="Inspector" class="flex min-w-0 overflow-auto">
        <For each={tabs}>
          {(tab) => (
            <button
              role="tab"
              class="btn px-2 text-xs"
              data-control="inspector-tab"
              data-itab={tab[0]}
              aria-selected={editor.store.state.layout.inspector === tab[0]}
              onClick={() => editor.actions.setInspectorTab(tab[0])}
            >
              {tab[1]}
            </button>
          )}
        </For>
      </div>
      <button
        id="btn-close-right"
        class="btn"
        aria-label="Close inspector"
        onClick={editor.actions.hideRightInspector}
      >
        ×
      </button>
    </header>
  );
}
