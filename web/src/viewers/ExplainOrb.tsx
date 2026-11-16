import { Spiral } from '../brand/Spiral.tsx';
import type { JSX } from 'solid-js';
import { createMemo, onCleanup, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { useEditor } from '../editor/context.tsx';
import { WalkthroughPanel } from './WalkthroughPanel.tsx';
import { orbView } from './orb-model.ts';
export function ExplainOrb(): JSX.Element {
  const editor = useEditor();
  const state = editor.store.state.explanation;
  const actions = editor.actions;
  const view = createMemo(() => (state.model ? orbView(state.model) : null));
  const hasWalkthrough = () => !!state.model?.walkthroughs.length;
  return (
    <>
      <Show when={state.model}>
        <div
          ref={(element) => {
            editor.services.registerExplanationCard?.(element);
            onCleanup(() => {
              if (editor.services.explanationCard?.() === element)
                editor.services.registerExplanationCard?.(undefined);
            });
          }}
          id="explain-orb"
          class={
            hasWalkthrough()
              ? 'card group max-w-full bg-popover text-popover-foreground shadow-pop data-[phase=done]:bg-popover/70 data-[phase=done]:backdrop-blur-sm'
              : 'group flex max-w-full flex-col gap-1'
          }
          data-size={hasWalkthrough() ? 'sm' : undefined}
          style={{ width: hasWalkthrough() ? 'min(28rem, calc(100vw - 2rem))' : undefined }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              if (state.walk) {
                actions.walkStop();
                queueMicrotask(() => editor.services.walkthrough?.focus());
              } else {
                actions.dismissOrb();
                if (editor.review.state.mode === 'review')
                  document.getElementById('review-diff-pane')?.focus();
                else editor.services.source?.focus();
              }
            }
          }}
          data-ui="explain-orb"
          data-phase={state.model?.phase}
        >
          <Dynamic
            component={hasWalkthrough() ? 'header' : 'div'}
            data-phase={state.model?.phase}
            class={
              hasWalkthrough()
                ? 'group flex min-w-0 w-full items-start'
                : 'group flex w-full items-center gap-1 overflow-hidden rounded-pill border bg-popover p-1 text-popover-foreground shadow-pop data-[phase=done]:items-start data-[phase=failed]:items-start data-[phase=done]:rounded-[var(--radius-xl)] data-[phase=failed]:rounded-[var(--radius-xl)] data-[phase=done]:bg-popover/70 data-[phase=done]:backdrop-blur-sm'
            }
          >
            <button
              id="explain-orb-open"
              class="btn relative min-w-0 shrink group-data-[phase=done]:h-auto group-data-[phase=done]:items-start group-data-[phase=done]:gap-2.5 group-data-[phase=done]:rounded-[var(--radius-lg)] group-data-[phase=done]:px-3 group-data-[phase=done]:py-2 group-data-[phase=done]:text-left group-data-[phase=failed]:h-auto group-data-[phase=failed]:items-start group-data-[phase=failed]:rounded-[var(--radius-lg)] group-data-[phase=failed]:text-left"
              // Cancel the small ghost button padding to align text with the card body.
              classList={{ '-ms-2.5': hasWalkthrough() }}
              data-variant="ghost"
              data-size="sm"
              aria-label={view()?.label}
              title={view()?.label}
              onClick={() => {
                const id = state.model?.id;
                if (id) void editor.actions.openThread(id);
              }}
            >
              <Show when={view()?.busy}>
                <span data-orb="spin" class="inline-flex shrink-0">
                  <Spiral state="thinking" size={18} />
                </span>
              </Show>
              <Show when={state.model?.phase === 'done'}>
                <span data-orb="done" class="mt-px inline-flex shrink-0">
                  <Spiral state="static" size={18} />
                </span>
              </Show>
              <Show when={state.model?.phase === 'failed'}>
                <span data-orb="fail" class="mt-px inline-flex shrink-0">
                  <Spiral state="error" size={18} label="Failed" />
                </span>
              </Show>
              <span class="flex min-w-0 max-w-md flex-col gap-0.5">
                <span data-orb="text" class="truncate">
                  {state.compact && hasWalkthrough() ? view()?.text : view()?.shown}
                </span>
                <Show when={view()?.snippet && !(hasWalkthrough() && state.compact)}>
                  <span
                    data-orb="snippet"
                    class="line-clamp-2 whitespace-normal font-normal text-muted-foreground"
                  >
                    {view()?.snippet}
                  </span>
                </Show>
              </span>
            </button>
            <Show when={hasWalkthrough()}>
              <button
                id="explain-orb-compact"
                class="btn ml-auto shrink-0"
                data-variant="ghost"
                data-size="icon-sm"
                aria-label={state.compact ? 'Expand walkthrough' : 'Compact walkthrough'}
                aria-expanded={!state.compact}
                aria-controls="walkthrough-panel"
                onClick={() => actions.setWalkCompact(!state.compact)}
              >
                <span
                  class={
                    state.compact
                      ? 'icon-[ph--caret-up-down]'
                      : 'icon-[ph--arrows-in-line-vertical]'
                  }
                />
              </button>
            </Show>
            <button
              id="explain-orb-close"
              class="btn shrink-0 group-data-[phase=done]:self-start group-data-[phase=failed]:self-start"
              classList={{ 'ml-auto': !hasWalkthrough() }}
              data-variant="ghost"
              data-size="icon-sm"
              aria-label="Close explanation"
              onClick={actions.dismissOrb}
            >
              <span class="icon-[ph--x]" />
            </button>
          </Dynamic>
          <Show
            when={state.model?.walkthroughs.length && `${state.model.id}:${state.model.turn}`}
            keyed
          >
            {(_key) => <WalkthroughPanel />}
          </Show>
        </div>
      </Show>
      <span id="explain-orb-live" class="sr-only" role="status" aria-live="polite">
        {editor.walkthrough.step()
          ? `Step ${editor.walkthrough.step()?.n} of ${editor.walkthrough.step()?.of}: ${editor.walkthrough.step()?.title}`
          : view()?.announce || ''}
      </span>
    </>
  );
}
