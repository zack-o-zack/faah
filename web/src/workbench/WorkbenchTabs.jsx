import { Index, Show } from 'solid-js';
import { useWorkbench } from './context.jsx';
import { Recent } from './Recent.jsx';
import { Browse } from './Browse.jsx';

export function WorkbenchTabs() {
  const { state, actions } = useWorkbench();
  return (
    <div id="wb-tabs" class="tabs mt-5 min-h-0 flex-1 gap-2">
      <nav
        role="tablist"
        aria-label="Workspaces"
        data-variant="line"
        class="w-full justify-start border-b [&>[role=tab]]:flex-none"
        onKeyDown={(e) => {
          if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            const tab = state.tab === 'recent' ? 'browse' : 'recent';
            actions.selectTab(tab);
            e.currentTarget.querySelector(`[aria-controls="panel-${tab}"]`).focus();
          }
        }}
      >
        <Index each={['recent', 'browse']}>
          {(tab) => (
            <button
              class="capitalize"
              id={`tab-${tab()}`}
              role="tab"
              tabindex={state.tab === tab() ? 0 : -1}
              aria-selected={state.tab === tab()}
              aria-controls={`panel-${tab()}`}
              onClick={() => actions.selectTab(tab())}
            >
              {tab()}
            </button>
          )}
        </Index>
      </nav>
      <div
        role="tabpanel"
        id={`panel-${state.tab}`}
        aria-labelledby={`tab-${state.tab}`}
        class={
          state.tab === 'recent'
            ? '-mx-2 min-h-0 overflow-y-auto px-2 pb-6'
            : 'flex min-h-0 flex-col pb-4'
        }
      >
        <Show when={state.tab === 'recent'} fallback={<Browse />}>
          <Recent />
        </Show>
      </div>
    </div>
  );
}
