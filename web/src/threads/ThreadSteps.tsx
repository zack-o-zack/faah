import type { JSX } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { EXPLAIN_STEP_LABELS } from './logic.ts';
import type { Thread, ThreadTurn } from './decode.ts';
import { For, Show } from 'solid-js';
export function ThreadSteps(props: { turn: ThreadTurn; thread?: Thread | null }): JSX.Element {
  const editor = useEditor();
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
              {(step) => {
                const walkthrough = () =>
                  step === EXPLAIN_STEP_LABELS.walkthrough && !!props.turn.walkthroughs?.length;
                const notes = () =>
                  step === EXPLAIN_STEP_LABELS.notes && !!props.turn.notes?.length;
                return (
                  <li class="flex items-start gap-1 whitespace-pre-wrap wrap-anywhere">
                    <span class="min-w-0 flex-1">{step}</span>
                    <Show when={props.thread && (notes() || walkthrough())}>
                      <button
                        class="btn shrink-0"
                        data-variant="ghost"
                        data-size="icon-xs"
                        title={walkthrough() ? 'Open walkthrough' : 'Show on code'}
                        aria-label={walkthrough() ? 'Open walkthrough' : 'Show on code'}
                        onClick={(event) => {
                          event.stopPropagation();
                          const thread = props.thread;
                          if (thread)
                            void editor.actions.showExplanation(thread, props.turn.id, {
                              walkthrough: walkthrough(),
                            });
                        }}
                      >
                        <span
                          class="icon-[lucide--sparkle] size-3 text-special"
                          aria-hidden="true"
                        />
                      </button>
                    </Show>
                  </li>
                );
              }}
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
