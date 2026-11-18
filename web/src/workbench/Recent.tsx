import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { useWorkbench } from './context.tsx';
import { RecentRow } from './RecentRow.tsx';

export function Recent(): JSX.Element {
  const { state, groups, actions } = useWorkbench();
  return (
    <>
      <div id="wb-recent">
        <For each={['prs', 'folders'] as const}>
          {(kind) => (
            <Show when={groups()[kind].length}>
              <section aria-labelledby={`wb-recent-${kind}`}>
                <h2
                  id={`wb-recent-${kind}`}
                  class="flex items-center gap-1.5 px-2.5 pt-2.5 pb-1 text-xs font-medium text-muted-foreground"
                >
                  {kind === 'prs' ? 'Pull requests' : 'Folders'}{' '}
                  <span class="rounded-full bg-(--hover) px-1.5 text-[11px]">
                    {groups()[kind].length}
                  </span>
                </h2>
                <ul class="flex flex-col gap-0.5">
                  <For each={groups()[kind]}>{(item) => <RecentRow item={item} />}</For>
                </ul>
              </section>
            </Show>
          )}
        </For>
      </div>
      <Show when={groups().prs.length + groups().folders.length < groups().total}>
        <button class="btn" data-variant="ghost" onClick={actions.showAll}>
          Show all {groups().total}
        </button>
      </Show>
      <Show when={!state.items.length}>
        <div class="empty py-12">
          <header>
            <figure class="flex size-10 items-center justify-center rounded-md bg-muted">
              <span class="icon-[ph--folder-open]" aria-hidden="true" />
            </figure>
            <h2>Nothing opened yet</h2>
            <p>Paste a pull request URL or a folder path above, or find the folder in Browse.</p>
          </header>
          <footer>
            <button
              class="btn"
              data-variant="outline"
              data-size="sm"
              onClick={() => actions.selectTab('browse')}
            >
              Browse folders
            </button>
          </footer>
        </div>
      </Show>
    </>
  );
}
