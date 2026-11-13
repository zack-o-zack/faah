import type { JSX } from 'solid-js';
import type { ThreadSummary } from './decode.ts';
import { Show } from 'solid-js';
import { targetRef } from '../agents/logic.ts';
import { relativeTime } from './logic.ts';
interface ThreadListRowProps {
  thread: ThreadSummary;
  selected: boolean;
  onOpen: () => void;
  onDelete: () => void;
}
export function ThreadListRow(props: ThreadListRowProps): JSX.Element {
  return (
    <div
      data-ui="thr-item"
      data-size="xs"
      data-id={props.thread.id}
      class="item group flex-col items-stretch gap-1 cursor-pointer hover:bg-accent [&.sel]:bg-accent"
      classList={{ sel: props.selected }}
      // aislop-ignore-next-line jsx-a11y/prefer-tag-over-role -- The row contains its own delete button; a native outer button would nest buttons.
      role="button"
      tabindex="0"
      onClick={() => props.onOpen()}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        props.onOpen();
      }}
    >
      <div data-ui="thr-item-title" class="flex min-w-0 items-center gap-2 text-sm font-medium">
        <Show when={props.thread.running}>
          <span
            data-ui="thr-spin"
            class="icon-[lucide--loader-circle] size-3.5 shrink-0 animate-spin text-muted-foreground"
            title="Working"
          />
        </Show>
        <Show when={!props.thread.running && props.thread.failed}>
          <span
            data-ui="thr-fail"
            class="icon-[lucide--circle-alert] size-3.5 shrink-0 text-destructive"
            title="Last reply failed"
          />
        </Show>
        <span data-ui="thr-item-title-text" class="min-w-0 flex-1 truncate">
          {props.thread.title}
        </span>
        <Show when={props.thread.kind}>
          <span class="badge" data-variant="secondary" data-control="thr-kind">
            {['batch', 'explain'].includes(props.thread.kind || '') ? props.thread.kind : 'inline'}
          </span>
        </Show>
        <button
          type="button"
          title="Delete this thread"
          aria-label="Delete thread"
          class="btn opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
          data-control="thr-item-del mini"
          data-variant="ghost"
          data-size="icon-xs"
          onClick={(event) => {
            event.stopPropagation();
            props.onDelete();
          }}
        >
          <span class="icon-[lucide--trash-2] size-3 shrink-0" aria-hidden="true" />
        </button>
      </div>
      <div data-ui="thr-item-meta" class="flex justify-between gap-2 text-xs text-muted-foreground">
        <span data-ui="thr-item-ref" class="truncate font-mono">
          {props.thread.path ? targetRef(props.thread) : 'Workspace'}
        </span>
        <span class="shrink-0">
          {props.thread.turns || 0} {props.thread.turns === 1 ? 'turn' : 'turns'} ·{' '}
          {relativeTime(props.thread.updated || 0, Date.now())}
        </span>
      </div>
    </div>
  );
}
