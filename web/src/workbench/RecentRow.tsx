import type { RecentItem } from './decode.ts';

interface RecentRowProps {
  item: RecentItem;
}
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { useWorkbench } from './context.tsx';
import { ago, recentSubtitle } from './logic.ts';
import { directoryIconClass } from './directory-row.ts';

export function RecentRow(props: RecentRowProps): JSX.Element {
  const { state, actions } = useWorkbench();
  const item = () => props.item;
  return (
    <li class="group flex min-w-0 items-center gap-3 rounded-[10px] px-2.5 py-2 text-[13px] hover:bg-(--hover)">
      <a class="flex min-w-0 flex-1 items-center gap-3" href={item().href}>
        <span class="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[8px] bg-(--surface-sunken)">
          <span
            class={`${directoryIconClass} ${item().kind === 'pr' ? 'icon-[ph--git-pull-request]' : 'icon-[ph--folder]'}`}
            aria-hidden="true"
          />
        </span>
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="truncate font-medium">
            {item().title || item().path || `#${item().number}`}
          </span>
          <span class="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <span class="truncate">{recentSubtitle(item(), state.home, state.sep)}</span>
            <Show
              when={
                item().kind === 'pr' && item().state !== 'starting' && item().state !== 'failed'
              }
            >
              <span class="shrink-0 rounded-[5px] bg-(--hover) px-1 font-mono text-[11.5px] text-foreground">
                #{item().number}
              </span>
            </Show>
          </span>
        </span>
      </a>
      <span class="w-[52px] shrink-0 text-right text-xs whitespace-nowrap text-muted-foreground max-sm:hidden">
        {ago(item().lastOpened || 0)}
      </span>
      <span class="flex w-[58px] shrink-0 justify-end gap-0.5">
        <button
          class="btn h-7 w-7 rounded-[8px] text-muted-foreground group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
          classList={{ 'pointer-events-none opacity-0': !item().pinned }}
          data-variant="ghost"
          data-size="icon-sm"
          aria-label={item().pinned ? 'Unpin' : 'Pin to the top'}
          onClick={() => actions.itemAction('pin', item())}
        >
          <span
            class={item().pinned ? 'icon-[ph--push-pin-fill]' : 'icon-[ph--push-pin]'}
            aria-hidden="true"
          />
        </button>
        <button
          class="btn pointer-events-none h-7 w-7 rounded-[8px] text-muted-foreground opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
          data-variant="ghost"
          data-size="icon-sm"
          aria-label="Remove from the list"
          onClick={() => actions.itemAction('remove', item())}
        >
          <span class="icon-[ph--x]" aria-hidden="true" />
        </button>
      </span>
    </li>
  );
}
