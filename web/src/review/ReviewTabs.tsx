interface ReviewTabProps {
  id: string;
  title: string;
  children?: JSX.Element;
}
import type { JSX } from 'solid-js';
import { For, Index, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { FILE_GROUPS, groupCounts, pipelineProgress } from './logic.ts';
import { Popover } from '../lib/Popover.tsx';
import { StageDot } from './StageDot.tsx';
export function ReviewTabs(): JSX.Element {
  const editor = useEditor();
  const review = editor.review;
  return (
    <div id="review-sub-bar" class="flex shrink-0 flex-wrap items-center gap-2 p-3 select-none">
      <div class="flex items-center gap-2" role="tablist">
        <ReviewTab id="walkthrough" title="Changed files grouped by kind">
          <span class="icon-[lucide--zap] size-3.5 shrink-0" aria-hidden="true" />
          <span>Changed files</span>
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
function ReviewTab(props: ReviewTabProps): JSX.Element {
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
function PipelineBadge(): JSX.Element {
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
function WalkthroughToolbar(): JSX.Element {
  const editor = useEditor();
  const review = editor.review;
  const counts = () => groupCounts(review.walkthroughData()?.files || []);
  const chips: { id: string; label: string; title: string; icon?: string }[] = [
    { id: 'all', label: 'All', title: 'Show all files' },
    ...FILE_GROUPS,
  ];
  return (
    <div class="flex items-center gap-2">
      <div class="flex flex-wrap items-center gap-1" role="group" aria-label="Filter file groups">
        <For each={chips.filter((chip) => chip.id === 'all' || counts()[chip.id])}>
          {(chip) => (
            <button
              title={chip.title}
              class="btn"
              data-variant={review.groupFilter() === chip.id ? 'secondary' : 'ghost'}
              data-size="xs"
              aria-pressed={review.groupFilter() === chip.id}
              onClick={() => editor.actions.setGroupFilter(chip.id)}
            >
              <Show when={chip.icon}>
                <span class={`${chip.icon} size-3 shrink-0`} aria-hidden="true" />
              </Show>
              {chip.label}
              <span class="tabular-nums text-muted-foreground">{counts()[chip.id]}</span>
            </button>
          )}
        </For>
      </div>
      <Popover
        triggerId="btn-walkthrough-options"
        triggerTitle="Diff options"
        accessibleLabel="Diff options"
        variant="ghost"
        size="icon-xs"
        autofocus
        label={<span class="icon-[lucide--settings] size-3.5 shrink-0" aria-hidden="true" />}
      >
        <div class="flex flex-col gap-3 p-3 text-xs">
          <h3 class="font-medium">Diff options</h3>
          <div class="flex flex-col gap-1.5">
            <span>Layout</span>
            <div class="button-group" role="group" aria-label="Layout">
              <For
                each={[
                  { label: 'Side by side', split: true },
                  { label: 'Unified', split: false },
                ]}
              >
                {(option) => (
                  <button
                    type="button"
                    class="btn"
                    data-size="sm"
                    aria-pressed={editor.store.settings.preferences().splitDiff === option.split}
                    data-variant={
                      editor.store.settings.preferences().splitDiff === option.split
                        ? 'secondary'
                        : 'outline'
                    }
                    onClick={() =>
                      void editor.store.settings.actions.setSetting(
                        'diffEditor.renderSideBySide',
                        option.split,
                      )
                    }
                  >
                    {option.label}
                  </button>
                )}
              </For>
            </div>
          </div>
          <div class="field" data-orientation="horizontal">
            <section>
              <label for="walkthrough-ignore-whitespace">Ignore whitespace</label>
              <p>Hides changes in spaces and blank lines</p>
            </section>
            <input
              id="walkthrough-ignore-whitespace"
              type="checkbox"
              role="switch"
              class="input"
              aria-label="Ignore whitespace"
              checked={editor.store.settings.value('diffEditor.ignoreWhitespace') === true}
              aria-checked={editor.store.settings.value('diffEditor.ignoreWhitespace') === true}
              onChange={(event) =>
                void editor.store.settings.actions.setSetting(
                  'diffEditor.ignoreWhitespace',
                  event.currentTarget.checked,
                )
              }
            />
          </div>
        </div>
      </Popover>
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
