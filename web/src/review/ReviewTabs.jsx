import { For, Index, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { INSIGHT_KINDS, insightCounts, pipelineProgress } from './logic.js';
import { StageDot } from './StageDot.jsx';
export function ReviewTabs() {
  const editor = useEditor();
  const review = editor.review;
  return (
    <div id="review-sub-bar" class="flex shrink-0 flex-wrap items-center gap-2 p-3 select-none">
      <div class="flex items-center gap-2" role="tablist">
        <ReviewTab id="walkthrough" title="Scrollytelling code diff and guardrail understanding">
          <span class="icon-[lucide--zap] size-3.5 shrink-0" aria-hidden="true" />
          <span>Diff & Understanding</span>
          <span class="badge" data-variant="secondary">
            {review.walkthroughData()?.totalFiles ?? 0}
          </span>
        </ReviewTab>
        <ReviewTab id="stages" title="Your coding harness answers each review question in turn">
          <span class="icon-[lucide--sparkle] size-3.5 shrink-0 text-special" aria-hidden="true" />
          <span>Review pipeline</span>
          <PipelineBadge />
        </ReviewTab>
      </div>
      <div class="flex-1" />
      <Show when={review.state.tab === 'walkthrough'}>
        <WalkthroughToolbar />
      </Show>
    </div>
  );
}
function ReviewTab(props) {
  const editor = useEditor();
  const selected = () => editor.review.state.tab === props.id;
  return (
    <button
      id={'btn-review-tab-' + props.id}
      role="tab"
      aria-selected={selected()}
      title={props.title}
      class="btn"
      data-variant={selected() ? 'secondary' : 'ghost'}
      data-size="xs"
      onClick={() => editor.actions.setReviewTab(props.id)}
    >
      {props.children}
    </button>
  );
}
// The tab carries the pipeline's progress, so it reads from the Diff tab too.
function PipelineBadge() {
  const review = useEditor().review;
  const progress = () => pipelineProgress(review.stages());
  return (
    <span
      class="badge gap-1 tabular-nums"
      data-variant="secondary"
      title={progress().title}
      aria-label={progress().title}
    >
      <Show
        when={progress().total <= 8}
        fallback={
          <>
            <StageDot status={progress().summary} />
            {progress().done}/{progress().total}
          </>
        }
      >
        <Index each={progress().statuses}>
          {(status) => <StageDot status={status()} class="size-1.5!" />}
        </Index>
      </Show>
    </span>
  );
}
function WalkthroughToolbar() {
  const editor = useEditor();
  const review = editor.review;
  const counts = () => insightCounts(review.walkthroughData()?.files || []);
  const chips = [{ id: 'all', label: 'All', title: 'Show all insights' }, ...INSIGHT_KINDS];
  return (
    <div class="flex items-center gap-2">
      <div class="flex flex-wrap items-center gap-1" role="group" aria-label="Filter insights">
        <For each={chips}>
          {(chip) => (
            <button
              title={chip.title}
              class="btn"
              data-variant={review.state.filter === chip.id ? 'secondary' : 'ghost'}
              data-size="xs"
              aria-pressed={review.state.filter === chip.id}
              onClick={() => editor.actions.setInsightFilter(chip.id)}
            >
              <Show when={chip.icon}>
                <span class={`${chip.icon} size-3 shrink-0`} aria-hidden="true" />
              </Show>
              {chip.label}
              <Show when={chip.id !== 'all'}>
                <span class="tabular-nums text-muted-foreground">{counts()[chip.id]}</span>
              </Show>
            </button>
          )}
        </For>
      </div>
      <button
        id="btn-refresh-walkthrough"
        title="Refresh walkthrough and diff"
        aria-label="Refresh walkthrough and diff"
        class="btn"
        data-variant="ghost"
        data-size="icon-xs"
        disabled={review.walkthrough.loading}
        onClick={editor.actions.refreshWalkthrough}
      >
        <span
          class="icon-[lucide--rotate-cw] size-3.5 shrink-0"
          classList={{ 'animate-spin': review.walkthrough.loading }}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}
