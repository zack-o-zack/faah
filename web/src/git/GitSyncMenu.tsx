import type { JSX } from 'solid-js';
import { For } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { DropdownMenu } from '../lib/DropdownMenu.tsx';
export function GitSyncMenu(): JSX.Element {
  const editor = useEditor();
  const ahead = () => editor.store.state.git.snapshot?.ahead || 0;
  const behind = () => editor.store.state.git.snapshot?.behind || 0;
  const counts = () =>
    [behind() ? behind() + '↓' : '', ahead() ? ahead() + '↑' : ''].filter(Boolean).join(' ');
  function itemCounts(id: string) {
    if (id === 'git-push') return ahead() ? ahead() + '↑' : '';
    if (id === 'git-pull') return behind() ? behind() + '↓' : '';
    return counts();
  }
  const items = [
    {
      id: 'git-sync-item',
      name: 'git sync',
      description: 'Pull new commits, then push yours',
      icon: 'icon-[lucide--refresh-cw]',
      run: () => editor.actions.syncGit(),
    },
    {
      id: 'git-pull',
      name: 'git pull',
      description: 'Bring in new commits from the remote',
      icon: 'icon-[lucide--arrow-down]',
      run: () => editor.actions.pullGit(),
    },
    {
      id: 'git-push',
      name: 'git push',
      description: 'Send your commits to the remote',
      icon: 'icon-[lucide--arrow-up]',
      run: () => editor.actions.pushGit(),
    },
  ];
  return (
    <div class="button-group" id="git-sync-group" role="group" aria-label="Sync with remote">
      <button
        id="git-sync"
        type="button"
        title="git sync: pull, then push"
        aria-label="git sync"
        class="btn gap-1 px-2!"
        data-variant="secondary"
        data-size="sm"
        disabled={!!editor.git.state.pending}
        onClick={() => void editor.actions.syncGit()}
      >
        <span
          data-ui="icon"
          class="icon-[lucide--refresh-cw] size-3.5 shrink-0"
          aria-hidden="true"
        />
        <span
          id="git-sync-counts"
          class="font-mono tabular-nums text-muted-foreground empty:hidden"
        >
          {counts()}
        </span>
      </button>
      <DropdownMenu
        triggerId="git-sync-caret"
        triggerClass="btn border-l border-background"
        variant="secondary"
        size="icon-sm"
        panelId="git-sync-menu"
        accessibleLabel="Sync actions"
        label={<span class="icon-[lucide--chevron-down] size-3.5 shrink-0" aria-hidden="true" />}
      >
        <For each={items}>
          {(item) => (
            <button
              id={item.id}
              type="button"
              role="menuitem"
              class="flex w-full items-start gap-2 text-left"
              disabled={!!editor.git.state.pending || (item.id === 'git-push' && !ahead())}
              onClick={() => void item.run()}
            >
              <span
                data-ui="icon"
                class={`${item.icon} mt-0.5 size-3.5 shrink-0`}
                aria-hidden="true"
              />
              <span class="flex min-w-0 flex-col items-start">
                <span>{item.name}</span>
                <span class="text-xs text-muted-foreground">{item.description}</span>
              </span>
              <span
                data-ui="label"
                class="ml-auto font-mono tabular-nums text-muted-foreground empty:hidden"
              >
                {itemCounts(item.id)}
              </span>
            </button>
          )}
        </For>
      </DropdownMenu>
    </div>
  );
}
