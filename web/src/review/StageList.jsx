import { createSignal, For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { ErrorNotice } from '../lib/ErrorNotice.tsx';
import { StageCard } from './StageCard.jsx';
export function StageList() {
  const editor = useEditor();
  const review = editor.review;
  return (
    <aside
      id="review-pipeline"
      class="flex w-72 max-w-1/2 shrink-0 flex-col overflow-hidden border-r group-[.layout-horizontal]/review:max-h-[40%] group-[.layout-horizontal]/review:w-full group-[.layout-horizontal]/review:max-w-none group-[.layout-horizontal]/review:border-r-0 group-[.layout-horizontal]/review:border-b"
    >
      <div class="flex flex-col gap-0.5 px-3 pt-3 pb-2">
        <div class="flex min-w-0 items-center gap-1.5">
          <span class="icon-[lucide--sparkle] size-3.5 shrink-0 text-special" aria-hidden="true" />
          <WorkflowName />
          <div class="-my-1 flex shrink-0 items-center">
            <button
              id="btn-toggle-review-layout"
              title="Stages beside or above the answer"
              aria-label="Toggle layout"
              class="btn"
              data-variant="ghost"
              data-size="icon-xs"
              onClick={() =>
                editor.actions.setReviewLayout(
                  review.state.layout === 'vertical' ? 'horizontal' : 'vertical',
                )
              }
            >
              <span
                class={`${review.state.layout === 'vertical' ? 'icon-[lucide--columns-2]' : 'icon-[lucide--rows-2]'} size-3.5 shrink-0`}
                aria-hidden="true"
              />
            </button>
            <button
              id="btn-add-review-stage"
              title="Add a stage"
              aria-label="Add a stage"
              class="btn"
              data-variant="ghost"
              data-size="icon-xs"
              onClick={() => editor.actions.openStageEditor(-1)}
            >
              <span class="icon-[lucide--plus] size-3.5 shrink-0" aria-hidden="true" />
            </button>
          </div>
        </div>
        <span class="truncate text-xs text-muted-foreground">
          Answered by your coding harness, in order.
        </span>
      </div>
      <ol
        id="review-stages-container"
        class="flex flex-1 flex-col overflow-y-auto px-1.5 pb-2"
        aria-label="Stages"
      >
        <For
          each={review.stages()}
          fallback={
            <li class="px-2 py-3 text-xs text-muted-foreground">No stages yet. Add one with +.</li>
          }
        >
          {(stage, index) => (
            <StageCard
              stage={stage}
              index={index()}
              last={index() === review.stages().length - 1}
            />
          )}
        </For>
      </ol>
      <div class="flex flex-col gap-2 border-t p-3">
        <ErrorNotice error={review.state.error} />
        <Show
          when={review.running()}
          fallback={
            <button
              id="btn-run-review-flow"
              title="Run every stage in order"
              class="btn w-full"
              data-variant="special"
              data-size="sm"
              disabled={review.state.pending === 'run' || !review.stages().length}
              onClick={() => void editor.actions.runReview(0)}
            >
              <span class="icon-[lucide--sparkle] size-3.5 shrink-0" aria-hidden="true" />
              <span>{review.state.pending === 'run' ? 'Starting…' : 'Run pipeline'}</span>
            </button>
          }
        >
          <button
            id="btn-stop-review-flow"
            title="Stop after the current answer"
            class="btn w-full"
            data-variant="outline"
            data-size="sm"
            disabled={review.state.pending === 'stop'}
            onClick={() => void editor.actions.stopReview()}
          >
            <span class="size-2.5 shrink-0 rounded-[2px] bg-current" aria-hidden="true" />
            <span>{review.state.pending === 'stop' ? 'Stopping…' : 'Stop'}</span>
          </button>
        </Show>
      </div>
    </aside>
  );
}
function WorkflowName() {
  const editor = useEditor();
  const [editing, setEditing] = createSignal(false);
  const commit = (value) => {
    setEditing(false);
    void editor.actions.renameReview(value);
  };
  return (
    <Show
      when={editing()}
      fallback={
        <button
          type="button"
          id="review-workflow-name"
          title="Click to edit workflow name"
          class="min-w-0 flex-1 truncate text-left text-sm font-semibold"
          onClick={() => setEditing(true)}
        >
          {editor.review.state.config.name}
        </button>
      }
    >
      <input
        class="input h-7! min-w-0 flex-1 text-sm"
        aria-label="Workflow name"
        value={editor.review.state.config.name}
        ref={(element) => queueMicrotask(() => element.select())}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit(event.currentTarget.value);
          if (event.key === 'Escape') {
            event.stopPropagation();
            setEditing(false);
          }
        }}
      />
    </Show>
  );
}
