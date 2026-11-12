import { For, Show } from 'solid-js';
import { useWorkbench } from './context.jsx';
import { Recent } from './Recent.jsx';
import { Browse } from './Browse.jsx';

export function WorkbenchTabs() {
  const { state, actions } = useWorkbench();
  return (
    <div class="tabs min-h-0 flex-1">
      <nav
        role="tablist"
        aria-label="Workspaces"
        data-variant="line"
        onKeyDown={(e) => {
          if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            const tab = state.tab === 'recent' ? 'browse' : 'recent';
            actions.selectTab(tab);
            e.currentTarget.querySelector(`[aria-controls="panel-${tab}"]`).focus();
          }
        }}
      >
        <For each={['recent', 'browse']}>
          {(tab) => (
            <button
              class="capitalize"
              id={`tab-${tab}`}
              role="tab"
              tabindex={state.tab === tab ? 0 : -1}
              aria-selected={state.tab === tab}
              aria-controls={`panel-${tab}`}
              onClick={() => actions.selectTab(tab)}
            >
              {tab}
            </button>
          )}
        </For>
      </nav>
      <div
        role="tabpanel"
        id={`panel-${state.tab}`}
        aria-labelledby={`tab-${state.tab}`}
        class="flex min-h-0 flex-1 flex-col overflow-auto"
      >
        <Show when={state.tab === 'recent'} fallback={<Browse />}>
          <Recent />
        </Show>
      </div>
    </div>
  );
}
