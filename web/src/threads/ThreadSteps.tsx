import type { JSX } from 'solid-js';
import type { ThreadTurn } from './decode.ts';
import { For, Show } from 'solid-js';
export function ThreadSteps(props: { turn: ThreadTurn }): JSX.Element {
  return (
    <Show when={props.turn.running || props.turn.tools?.length}>
      <Show
        when={props.turn.tools?.length}
        fallback={
          <div data-ui="thr-steps" class="flex items-start gap-1.5 text-xs text-muted-foreground">
            <StepHead turn={props.turn} />
          </div>
        }
      >
        <details
          data-ui="thr-steps"
          class="group text-xs text-muted-foreground [&::details-content]:overflow-hidden"
        >
          <summary class="flex cursor-pointer list-none items-start gap-1.5 hover:text-foreground [&::-webkit-details-marker]:hidden">
            <StepHead turn={props.turn} />
          </summary>
          <ol data-ui="thr-step-list" class="mt-1.5 ml-1.5 flex flex-col gap-1 border-l pl-3">
            <For each={props.turn.tools}>
              {(step) => <li class="whitespace-pre-wrap wrap-anywhere">{step}</li>}
            </For>
          </ol>
        </details>
      </Show>
    </Show>
  );
}
function StepHead(props: { turn: ThreadTurn }): JSX.Element {
  return (
    <Show
      when={props.turn.running}
      fallback={
        <>
          <span
            class="icon-[lucide--chevron-right] mt-px size-3 shrink-0 transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
          {props.turn.tools?.length} {props.turn.tools?.length === 1 ? 'step' : 'steps'}
        </>
      }
    >
      <span
        class="icon-[lucide--loader-circle] mt-px size-3 shrink-0 animate-spin"
        aria-hidden="true"
      />
      <span class="line-clamp-2 min-w-0 wrap-anywhere">
        {props.turn.tools?.at(-1) || 'Starting'}
      </span>
    </Show>
  );
}
