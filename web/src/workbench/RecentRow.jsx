import { Show } from 'solid-js';
import { useWorkbench } from './context.jsx';
import { ago, recentSubtitle } from './logic.ts';

export function RecentRow(props) {
  const { state, actions } = useWorkbench();
  const item = () => props.item;
  return (
    <li>
      <div class="item min-w-0" data-size="sm">
        <a class="min-w-0 flex-1" href={item().href}>
          <h3 class="truncate">{item().title || item().path || `#${item().number}`}</h3>
          <p class="truncate text-xs text-muted-foreground">
            {recentSubtitle(item(), state.home, state.sep)}
          </p>
        </a>
        <span class="text-xs text-muted-foreground max-sm:hidden">{ago(item().lastOpened)}</span>
        <button
          class="btn"
          data-variant="ghost"
          aria-label={item().pinned ? 'Unpin' : 'Pin to the top'}
          onClick={() => actions.itemAction('pin', item())}
        >
          <span
            class={item().pinned ? 'icon-[lucide--pin-off] size-4' : 'icon-[lucide--pin] size-4'}
          />
        </button>
        <button
          class="btn"
          data-variant="ghost"
          aria-label="Remove from the list"
          onClick={() => actions.itemAction('remove', item())}
        >
          <span class="icon-[lucide--x] size-4" />
        </button>
        <Show when={item().state === 'running'}>
          <button
            class="btn"
            data-variant="ghost"
            aria-label="Stop this workspace"
            onClick={() => actions.itemAction('stop', item())}
          >
            <span class="icon-[lucide--square] size-4 text-destructive" />
          </button>
        </Show>
      </div>
    </li>
  );
}
