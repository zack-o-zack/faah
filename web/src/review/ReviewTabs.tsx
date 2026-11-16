interface ReviewTabProps {
  id: string;
  title: string;
  name: string;
  icon: string;
  info: JSX.Element;
}
import { isThreadRunning } from '../threads/logic.ts';
import { handleTabKeys } from '../lib/tab-keys.ts';
import type { JSX } from 'solid-js';
import { createMemo, For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { FILE_GROUPS, groupCounts } from './logic.ts';
import { DiffOptions } from '../viewers/DiffOptions.tsx';
import { TabStatus, tabStatus } from './TabStatus.tsx';
export function ReviewTabs(): JSX.Element {
  const editor = useEditor();
  const review = editor.review;
  const explaining = () =>
    editor.threads.state.pending === 'explain' ||
    editor.threads.state.list.some(
      (thread) => thread.kind === 'explain' && !thread.path && thread.running,
    ) ||
    Object.values(editor.threads.state.records).some(
      (thread) =>
        thread.explainReq &&
        'pr' in thread.explainReq &&
        thread.explainReq.pr &&
        isThreadRunning(thread),
    );
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
          <ReviewTab
            id="overview"
            name="Overview"
            icon="icon-[lucide--layout-dashboard]"
            title="PR description, checks and approvals"
            info={<ChecksStatus />}
          />
          <ReviewTab
            id="walkthrough"
            name="Changed files"
            icon="icon-[lucide--zap]"
            title="Changed files grouped by kind"
            info={<FilesStatus />}
          />
          <ReviewTab
            id="stages"
            name="Review pipeline"
            icon="icon-[lucide--sparkle] text-special"
            title="Your coding harness answers each review question in turn"
            info={<PipelineStatus />}
          />
        </nav>
      </div>
      <div class="flex-1" />
      <Show when={review.state.tab === 'walkthrough'}>
        <WalkthroughToolbar />
      </Show>
      <button
        class="btn"
        data-variant="special"
        data-size="xs"
        aria-label="Explain PR"
        title="Explain this PR"
        disabled={explaining()}
        onClick={async () => {
          await editor.actions.explainSelection({ pr: true });
          editor.actions.setReviewTab('walkthrough');
        }}
      >
        <span
          class={`${explaining() ? 'icon-[lucide--loader-circle] animate-spin motion-reduce:animate-none' : 'icon-[lucide--sparkle]'} size-3.5 shrink-0`}
          aria-hidden="true"
        />
        Explain PR
      </button>
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
      class="group/tab text-xs!"
      onClick={() => editor.actions.setReviewTab(props.id)}
    >
      <span data-tab-label class="flex items-center gap-1.5">
        <span class={`${props.icon} size-3.5 shrink-0`} aria-hidden="true" />
        {props.name}
      </span>
      {props.info}
    </button>
  );
}
function ChecksStatus(): JSX.Element {
  const review = useEditor().review;
  const statuses = createMemo(
    () => review.overviewData()?.checks.map((check) => tabStatus(check.state)) || [],
  );
  return (
    <TabStatus
      noun="checks"
      statuses={statuses()}
      loading={review.overview.loading}
      error={!!review.overview.error}
    />
  );
}
function FilesStatus(): JSX.Element {
  const editor = useEditor();
  const review = editor.review;
  const count = () =>
    review.walkthroughData()?.totalFiles ??
    Object.keys(editor.store.state.workspace.meta?.pr?.files || {}).length;
  return <TabStatus noun="files" count={count()} loading={review.walkthrough.loading} />;
}
function PipelineStatus(): JSX.Element {
  const review = useEditor().review;
  const statuses = createMemo(() =>
    review.stages().map((stage) => tabStatus(stage.status || 'pending')),
  );
  return (
    <TabStatus noun="stages" statuses={statuses()} loading={review.state.pending === 'load'} />
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
      <DiffOptions id="btn-walkthrough-options" />
    </div>
  );
}
