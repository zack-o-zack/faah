import { TabRail } from '../lib/TabRail.tsx';
import type { JSX } from 'solid-js';
import { For } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
export function InspectorToolbar(): JSX.Element {
  const editor = useEditor();
  const tabs: [string, string][] = [
    ['refs', 'References'],
    ['symbols', 'Symbols'],
    ['calls', 'Calls'],
    ['search', 'Search'],
  ];
  return (
    <header class="inspector-head desktop:min-h-[var(--titlebar-h,2.5rem)] desktop:[-webkit-app-region:drag] desktop:[&_button]:[-webkit-app-region:no-drag] desktop:[&_a]:[-webkit-app-region:no-drag] desktop:[&_[role=group]]:[-webkit-app-region:no-drag] desktop:[&_[role=tab]]:[-webkit-app-region:no-drag] flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
      <TabRail label="Inspector" size="default">
        <For each={tabs}>
          {(tab) => (
            <button
              role="tab"
              id={'inspector-tab-' + tab[0]}
              aria-controls={'pane-right-' + tab[0]}
              tabindex={editor.store.state.layout.inspector === tab[0] ? 0 : -1}
              data-control="inspector-tab"
              data-itab={tab[0]}
              aria-selected={editor.store.state.layout.inspector === tab[0]}
              onClick={() => editor.actions.setInspectorTab(tab[0])}
            >
              {tab[1]}
            </button>
          )}
        </For>
      </TabRail>
      <div class="inspector-head-actions flex items-center">
        <button
          id="btn-close-right"
          class="btn"
          aria-label="Close inspector"
          onClick={editor.actions.hideRightInspector}
          data-variant="ghost"
          data-size="icon-xs"
          data-control="icon-action"
        >
          <span class="icon-[ph--x] size-3.5 shrink-0" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
