import { decodeWorkbenchMetrics } from './decode.ts';
import type { JSX } from 'solid-js';
import { createResource, Show } from 'solid-js';
import { useWorkbench } from './context.tsx';
import { api } from '../lib/api.ts';
import { createPolling } from '../lib/events.ts';
import { createShortcut } from '../lib/shortcuts.tsx';
import { Clone } from './Clone.tsx';
import { OpenWorkspaceForm } from './OpenWorkspaceForm.tsx';
import { WorkbenchTabs } from './WorkbenchTabs.tsx';
import { WorkbenchHeader } from './WorkbenchHeader.tsx';
import { WorkbenchFooter } from './WorkbenchFooter.tsx';

export function Workbench(): JSX.Element {
  const { state, actions } = useWorkbench();
  const [metrics, { refetch }] = createResource(async () => {
    try {
      return decodeWorkbenchMetrics(await api('api/metrics'));
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
      <div class="flex min-h-0 flex-1 flex-col">
        <main class="mx-auto flex min-h-0 w-full max-w-[720px] flex-1 flex-col px-4 pt-14">
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
      </div>
      <WorkbenchFooter metrics={metrics()} />
    </div>
  );
}
