import { For, Show } from 'solid-js';
import { useWorkbench } from './context.jsx';
import { RecentRow } from './RecentRow.jsx';

export function Recent() {
  const { state, groups, actions } = useWorkbench();
  return (
    <>
      <ul class="item-group">
        <Show when={groups().pinned.length}>
          <li class="text-xs text-muted-foreground">Pinned</li>
        </Show>
        <For each={groups().pinned}>{(item) => <RecentRow item={item} />}</For>
        <Show when={groups().pinned.length && groups().recent.length}>
          <li class="text-xs text-muted-foreground">Recent</li>
        </Show>
        <For each={groups().recent}>{(item) => <RecentRow item={item} />}</For>
      </ul>
      <Show when={groups().pinned.length + groups().recent.length < groups().total}>
        <button class="btn" data-variant="ghost" onClick={actions.showAll}>
          Show all {groups().total}
        </button>
      </Show>
      <Show when={!state.items.length}>
        <div class="empty py-12">
          <header>
            <h2>Nothing opened yet</h2>
            <p>Paste a pull request URL or a folder path above, or find the folder in Browse.</p>
          </header>
          <footer>
            <button class="btn" data-variant="outline" onClick={() => actions.selectTab('browse')}>
              Browse folders
            </button>
          </footer>
        </div>
      </Show>
    </>
  );
}
