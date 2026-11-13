import { createMemo, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { orbView } from './orb-model.js';
export function ExplainOrb() {
  const editor = useEditor();
  const state = editor.store.state.explanation;
  const actions = editor.actions;
  const view = createMemo(() => (state.model ? orbView(state.model) : null));
  return (
    <>
      <Show
        when={
          state.model &&
          !(editor.threads.showing() && editor.threads.state.current === state.model.id)
        }
      >
        <div
          id="explain-orb"
          data-ui="explain-orb"
          data-phase={state.model.phase}
          class="group flex max-w-full items-center overflow-hidden rounded-full border bg-popover text-popover-foreground shadow-md data-[phase=done]:items-start data-[phase=done]:rounded-xl data-[phase=done]:bg-popover/70 data-[phase=done]:backdrop-blur-sm"
        >
          <button
            id="explain-orb-open"
            class="btn min-w-0 shrink group-data-[phase=done]:h-auto group-data-[phase=done]:items-start group-data-[phase=done]:py-2 group-data-[phase=done]:text-left"
            data-variant="ghost"
            data-size="sm"
            aria-label={view().label}
            title={view().label}
            onClick={() => {
              const id = state.model.id;
              if (!view().busy) actions.dismissOrb();
              if (id) void editor.actions.openThread(id);
            }}
          >
            <Show when={view().busy}>
              <span
                data-orb="spin"
                class="size-3 shrink-0 rounded-full border-2 border-border border-t-primary animate-spin motion-reduce:animate-none"
              />
            </Show>
            <Show when={state.model.phase === 'done'}>
              <span data-orb="done" class="icon-[lucide--check] size-3.5 text-primary" />
            </Show>
            <Show when={state.model.phase === 'failed'}>
              <span data-orb="fail" class="icon-[lucide--circle-alert] size-3.5 text-destructive" />
            </Show>
            <span class="flex min-w-0 max-w-md flex-col gap-0.5">
              <span data-orb="text" class="truncate">
                {view().shown}
              </span>
              <Show when={view().snippet}>
                <span data-orb="snippet" class="line-clamp-2 whitespace-normal font-normal">
                  {view().snippet}
                </span>
              </Show>
            </span>
          </button>
          <Show when={!view().busy}>
            <button
              id="explain-orb-close"
              class="btn"
              data-variant="ghost"
              data-size="icon-sm"
              aria-label="Dismiss"
              onClick={actions.dismissOrb}
            >
              <span class="icon-[lucide--x] size-3.5" />
            </button>
          </Show>
        </div>
      </Show>
      <span id="explain-orb-live" class="sr-only" role="status" aria-live="polite">
        {view()?.announce || ''}
      </span>
    </>
  );
}
