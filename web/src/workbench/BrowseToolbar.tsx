import type { DirectoryEntry } from './decode.ts';

interface BrowseToolbarProps {
  selected?: DirectoryEntry;
  onMkdir: () => void;
  onOpen: () => void;
}
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { useWorkbench } from './context.tsx';
import { breadcrumbs } from './logic.ts';
import { Kbd } from '../lib/shortcuts.tsx';
export function BrowseToolbar(props: BrowseToolbarProps): JSX.Element {
  const { state, actions } = useWorkbench();
  const crumbs = () => breadcrumbs(state.directory.path, state.home, state.sep);
  const targetName = () =>
    props.selected?.name ||
    state.directory.path.split(state.sep).filter(Boolean).at(-1) ||
    state.sep;
  return (
    <div class="flex items-center gap-1.5 border-b p-2">
      <button
        class="btn h-7! w-7! shrink-0 text-muted-foreground"
        data-variant="ghost"
        data-size="icon"
        aria-label="Up one folder"
        disabled={!state.directory.parent}
        onClick={() => actions.browse(state.directory.parent)}
      >
        <span class="icon-[ph--arrow-up] h-4 w-4" aria-hidden="true" />
      </button>
      <nav
        class="flex min-w-0 flex-1 items-center gap-px overflow-x-auto whitespace-nowrap"
        aria-label="Folder path"
      >
        <For each={crumbs()}>
          {(crumb, index) => (
            <>
              <Show when={index() > 0}>
                <span
                  class="icon-[ph--caret-right] h-3 w-3 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </Show>
              <button
                class="btn h-7! shrink-0 px-[5px]! text-[12.5px]"
                classList={{ 'text-muted-foreground': index() < crumbs().length - 1 }}
                data-variant="ghost"
                aria-current={index() === crumbs().length - 1 ? 'location' : undefined}
                onClick={() => actions.browse(crumb.path)}
              >
                {crumb.name}
              </button>
            </>
          )}
        </For>
      </nav>
      <button
        class="btn h-7! w-7! shrink-0 text-muted-foreground"
        data-variant="ghost"
        data-size="icon"
        aria-label="New folder"
        onClick={() => props.onMkdir()}
      >
        <span class="icon-[ph--folder-plus] h-4 w-4" aria-hidden="true" />
      </button>
      <button
        class="btn h-7! w-7! shrink-0 text-muted-foreground"
        data-variant="ghost"
        data-size="icon"
        aria-label="Show hidden folders"
        aria-pressed={state.hidden}
        onClick={actions.toggleHidden}
      >
        <span
          class={`h-4 w-4 ${state.hidden ? 'icon-[ph--eye]' : 'icon-[ph--eye-slash]'}`}
          aria-hidden="true"
        />
      </button>
      <button
        class="btn h-7! min-w-0 max-w-1/2 shrink-0 gap-2 pr-[7px]! pl-3! text-[13px]"
        onClick={() => props.onOpen()}
      >
        <span class="truncate">
          {state.clone ? 'Use' : 'Open'} {targetName()}
        </span>
        <Kbd combo="Mod+Enter" variant="button" class="shrink-0" />
      </button>
    </div>
  );
}
