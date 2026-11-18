import type { JSX } from 'solid-js';
import { For, Match, Switch } from 'solid-js';
import { useWorkbench } from './context.tsx';
import { directoryIconClass, directoryRowClass } from './directory-row.ts';

export function DirectoryPreview(props: { onNavigate: () => void }): JSX.Element {
  const { state, actions } = useWorkbench();
  return (
    <section
      aria-label="Folder preview"
      aria-busy={state.preview.busy}
      class="min-h-0 min-w-0 overflow-auto border-l bg-(--surface-sunken) max-sm:hidden"
    >
      <Switch
        fallback={
          <ul class="p-1">
            <For each={state.preview.entries}>
              {(entry) => (
                <li>
                  <button
                    class={`${directoryRowClass} w-full`}
                    classList={{
                      'text-muted-foreground': entry.name.startsWith('.'),
                      'text-foreground': !entry.name.startsWith('.'),
                    }}
                    onClick={() => {
                      props.onNavigate();
                      actions.browse(entry.path);
                    }}
                  >
                    <span
                      aria-hidden="true"
                      class={`${directoryIconClass} ${entry.git ? 'icon-[ph--git-branch]' : 'icon-[ph--folder]'}`}
                    />
                    <span class="min-w-0 flex-1 truncate text-left">{entry.name}</span>
                    <span
                      aria-hidden="true"
                      class="icon-[ph--caret-right] h-3 w-3 shrink-0 text-muted-foreground"
                    />
                  </button>
                </li>
              )}
            </For>
          </ul>
        }
      >
        <Match when={!state.preview.path}>
          <p class="p-8 text-[13px] text-muted-foreground">Select a folder to look inside</p>
        </Match>
        <Match when={state.preview.busy}>
          <p class="p-8 text-[13px] text-muted-foreground">Loading…</p>
        </Match>
        <Match when={state.preview.error}>
          <p class="p-8 text-[13px] text-muted-foreground">{state.preview.error}</p>
        </Match>
        <Match when={!state.preview.entries.length}>
          <p class="p-8 text-[13px] text-muted-foreground">No folders inside</p>
        </Match>
      </Switch>
    </section>
  );
}
