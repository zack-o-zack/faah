import { Match, Show, Switch } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { ThreadTranscript } from '../threads/ThreadTranscript.jsx';
import { STAGE_STATUS, stageStatus } from './logic.ts';
import { StageDot } from './StageDot.jsx';
import { StageEditor } from './StageEditor.jsx';
import { StageTurn } from './StageTurn.jsx';
import { ReviewCompose } from './ReviewCompose.jsx';
export function StageView() {
  const editor = useEditor();
  const review = editor.review;
  const stage = () => review.active();
  const thread = () => editor.threads.state.records[stage()?.threadId] || null;
  return (
    <section id="review-stage-main" class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <Show when={stage()}>
        <StageHeader />
      </Show>
      <Show when={review.state.edit}>
        <StageEditor />
      </Show>
      <Switch>
        <Match when={!stage()}>
          <div class="flex-1" />
        </Match>
        <Match when={!stage().threadId}>
          <div
            id="review-thread-msgs"
            data-ui="review-thread-msgs thr-msgs"
            class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
          >
            <div
              data-ui="review-thread-placeholder"
              class="empty flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground"
            >
              <p>Your coding harness hasn't answered this one yet.</p>
              <button
                id="btn-start-single-stage"
                class="btn"
                data-variant="special"
                data-size="sm"
                data-control="bar-action"
                disabled={review.running() || review.state.pending === 'run'}
                onClick={() => void editor.actions.runReview(review.state.active)}
              >
                <span class="icon-[lucide--sparkle] size-3.5 shrink-0" aria-hidden="true" />
                Run this stage
              </button>
            </div>
          </div>
        </Match>
        <Match when={!thread() && review.state.loadingThread === stage().threadId}>
          <p class="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
            <span class="icon-[lucide--loader-circle] size-3.5 animate-spin" aria-hidden="true" />
            Loading the answer…
          </p>
        </Match>
        <Match when={!thread()}>
          <p class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            This stage's answer is no longer available. Run the stage again for a new one.
          </p>
        </Match>
        <Match when={thread()}>
          <ThreadTranscript
            id="review-thread-msgs"
            thread={thread()}
            class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
          >
            {(turn, index) => <StageTurn turn={turn} first={index() === 0} />}
          </ThreadTranscript>
        </Match>
      </Switch>
      <ReviewCompose />
    </section>
  );
}
function StageHeader() {
  const editor = useEditor();
  const review = editor.review;
  const status = () => stageStatus(review.active());
  const def = () => review.active().def;
  return (
    <header class="flex items-start gap-3 border-b px-4 py-3">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <span class="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            Stage {review.state.active + 1} of {review.stages().length}
          </span>
          <span aria-hidden="true">·</span>
          <span class="inline-flex items-center gap-1.5">
            <StageDot status={status()} />
            {STAGE_STATUS[status()].label}
          </span>
        </span>
        <h2 id="review-stage-title" class="min-w-0 truncate text-base font-semibold">
          {def().title || `Stage ${review.state.active + 1}`}
        </h2>
        <Show
          when={
            (!review.state.edit || review.state.edit.index < 0) && (def().question || def().prompt)
          }
        >
          <div
            id="review-question-banner"
            data-ui="review-question-banner"
            class="flex min-w-0 items-start gap-1"
          >
            <span
              id="review-question-text"
              data-ui="review-question-text"
              class="min-w-0 text-sm text-muted-foreground"
            >
              {def().question || def().prompt}
            </span>
          </div>
        </Show>
      </div>
      <div class="flex shrink-0 items-center">
        <button
          id="btn-edit-stage-inline"
          title="Edit this stage's title, question and instructions"
          aria-label="Edit this stage"
          class="btn"
          data-variant="ghost"
          data-size="icon-sm"
          onClick={() => editor.actions.openStageEditor(review.state.active)}
        >
          <span class="icon-[lucide--square-pen] size-3.5 shrink-0" aria-hidden="true" />
        </button>
        <button
          id="btn-rerun-stage"
          title="Run this stage again"
          aria-label="Run this stage again"
          class="btn"
          data-variant="ghost"
          data-size="icon-sm"
          disabled={review.running() || review.state.pending === 'run'}
          onClick={() => void editor.actions.runReview(review.state.active)}
        >
          <span class="icon-[lucide--rotate-cw] size-3.5 shrink-0" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
