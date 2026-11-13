import { createResource, Show } from 'solid-js';
import { useWorkbench } from './context.jsx';
import { api } from '../lib/api.ts';
import { createPolling } from '../lib/events.ts';
import { createShortcut } from '../lib/shortcuts.jsx';
import { Clone } from './Clone.jsx';
import { OpenWorkspaceForm } from './OpenWorkspaceForm.jsx';
import { WorkbenchTabs } from './WorkbenchTabs.jsx';
import { WorkbenchHeader } from './WorkbenchHeader.jsx';
import { WorkbenchFooter } from './WorkbenchFooter.jsx';

export function Workbench() {
  const { state, actions } = useWorkbench();
  const [metrics, { refetch }] = createResource(async () => {
    try {
      return await api('api/metrics');
    } catch {
      return null;
    }
  });
  createPolling(async () => {
    await actions.refresh();
    await refetch();
  }, 2000);
  createShortcut('Mod+Shift+.', actions.toggleHidden, {
    when: () => state.tab === 'browse',
    inputs: true,
  });
  return (
    <div class="flex h-dvh flex-col">
      <button
        data-desktop-menu
        class="btn desktop-menu-btn hidden! win-linux:inline-flex!"
        aria-label="Application menu"
      >
        <span class="icon-[lucide--menu] size-4" />
      </button>
      <main class="mx-auto flex min-h-0 w-full max-w-[720px] flex-1 flex-col gap-4 px-4 pt-14 pb-6">
        <WorkbenchHeader />
        <OpenWorkspaceForm />
        <Show when={state.error}>
          <p role="alert" class="text-sm text-destructive">
            {state.error}
          </p>
        </Show>
        <Show when={state.clone}>
          <Clone />
        </Show>
        <WorkbenchTabs />
      </main>
      <WorkbenchFooter metrics={metrics()} />
    </div>
  );
}
