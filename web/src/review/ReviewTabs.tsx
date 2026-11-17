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
import { createMemo, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
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
    <div
      id="review-sub-bar"
      class="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 select-none"
    >
      <div class="tabs min-w-0 overflow-x-auto">
        <nav
          role="tablist"
          aria-orientation="horizontal"
          aria-label="Review"
          data-variant="line"
          class="h-9 items-stretch gap-4.5 rounded-none bg-transparent p-0 [&>[role=tab]]:flex-none"
          onKeyDown={handleTabKeys}
        >
          <ReviewTab
            id="overview"
            name="Overview"
            icon="icon-[ph--squares-four]"
            title="PR description, checks and approvals"
            info={<ChecksStatus />}
          />
          <ReviewTab
            id="walkthrough"
            name="Changed files"
            icon="icon-[ph--git-diff]"
            title="Changed files grouped by kind"
            info={<FilesStatus />}
          />
          <ReviewTab
            id="stages"
            name="Review pipeline"
            icon="icon-[ph--list-checks]"
            title="Your coding harness answers each review question in turn"
            info={<PipelineStatus />}
          />
        </nav>
      </div>
      <div class="flex-1" />
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
          class="icon-[ph--spinner] shrink-0"
          classList={{ 'motion-safe:animate-spin': explaining() }}
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
            class="icon-[ph--arrow-clockwise] shrink-0"
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
      class="px-0 py-0 text-12-5! text-muted-foreground aria-selected:text-foreground after:-bottom-px"
      onClick={() => editor.actions.setReviewTab(props.id)}
    >
      <span data-tab-label class="flex items-center gap-1.5">
        <span class={`${props.icon} shrink-0`} aria-hidden="true" />
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
