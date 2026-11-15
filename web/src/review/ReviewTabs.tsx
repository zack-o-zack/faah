interface ReviewTabProps {
  id: string;
  title: string;
  children?: JSX.Element;
}
import { handleTabKeys } from '../lib/tab-keys.ts';
import type { JSX } from 'solid-js';
import { createMemo, For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { FILE_GROUPS, groupCounts } from './logic.ts';
import { DiffOptions } from '../viewers/DiffOptions.tsx';
import { StatusBadge, badgeStatus } from './StatusBadge.tsx';
export function ReviewTabs(): JSX.Element {
  const editor = useEditor();
  const review = editor.review;
  return (
    <div id="review-sub-bar" class="flex shrink-0 flex-wrap items-center gap-2 p-3 select-none">
      <div class="tabs min-w-0 overflow-x-auto">
        <nav
          role="tablist"
          aria-orientation="horizontal"
          aria-label="Review"
          class="[&>[role=tab]]:flex-none"
          onKeyDown={handleTabKeys}
        >
          <ReviewTab id="overview" title="PR description, checks and approvals">
            <span class="icon-[lucide--layout-dashboard] size-3.5 shrink-0" aria-hidden="true" />
            <span>Overview</span>
            <ChecksBadge />
          </ReviewTab>
          <ReviewTab id="walkthrough" title="Changed files grouped by kind">
            <span class="icon-[lucide--zap] size-3.5 shrink-0" aria-hidden="true" />
            <span>Changed files</span>
            <span class="badge" data-variant="outline">
              {review.walkthroughData()?.totalFiles ??
                Object.keys(editor.store.state.workspace.meta?.pr?.files || {}).length}
            </span>
          </ReviewTab>
          <ReviewTab id="stages" title="Your coding harness answers each review question in turn">
            <span
              class="icon-[lucide--sparkle] size-3.5 shrink-0 text-special"
              aria-hidden="true"
            />
            <span>Review pipeline</span>
            <PipelineBadge />
          </ReviewTab>
        </nav>
      </div>
      <div class="flex-1" />
      <Show when={review.state.tab === 'walkthrough'}>
        <WalkthroughToolbar />
      </Show>
      <Show when={review.state.tab !== 'stages'}>
        <button
          id="btn-refresh-review"
          title="Refresh review"
          aria-label="Refresh review"
          class="btn"
          data-variant="ghost"
          data-size="icon-xs"
          disabled={
            review.state.tab === 'overview' ? review.overview.loading : review.walkthrough.loading
          }
          onClick={editor.actions.refreshReview}
        >
          <span
            class="icon-[lucide--rotate-cw] size-3.5 shrink-0"
            classList={{
              'animate-spin':
                review.state.tab === 'overview'
                  ? review.overview.loading
                  : review.walkthrough.loading,
            }}
            aria-hidden="true"
          />
        </button>
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
      type="button"
      role="tab"
      tabindex={selected() ? 0 : -1}
      aria-controls={
        props.id === 'overview'
          ? 'pr-overview'
          : `review-${props.id === 'stages' ? 'stages' : 'walkthrough'}-view`
      }
      aria-selected={selected()}
      title={props.title}
      class="text-xs!"
      onClick={() => editor.actions.setReviewTab(props.id)}
    >
      {props.children}
    </button>
  );
}
function ChecksBadge(): JSX.Element {
  const review = useEditor().review;
  const statuses = createMemo(
    () => review.overviewData()?.checks.map((check) => badgeStatus(check.state)) || [],
  );
  return (
    <Show when={!review.overview.loading && !review.overview.error}>
      <StatusBadge noun="checks" statuses={statuses()} />
    </Show>
  );
}
function PipelineBadge(): JSX.Element {
  const review = useEditor().review;
  const statuses = createMemo(() =>
    review.stages().map((stage) => badgeStatus(stage.status || 'pending')),
  );
  return <StatusBadge noun="stages" statuses={statuses()} />;
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
      <DiffOptions id="btn-walkthrough-options" />
    </div>
  );
}
