interface EmptyStateProps {
  icon?: string;
  spinner?: boolean;
  title: string;
  children?: JSX.Element;
}
import type { JSX } from 'solid-js';
import { For, Match, Show, Switch } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { FILE_GROUPS, groupCounts, visibleFiles } from './logic.ts';
import { CountPill } from './CountPill.tsx';
import { DiffOptions } from '../viewers/DiffOptions.tsx';
import { WalkthroughFiles } from './WalkthroughFiles.tsx';
import { WalkthroughDiff } from './WalkthroughDiff.tsx';
export function Walkthrough(): JSX.Element {
  const review = useEditor().review;
  const files = review.reviewFiles;
  return (
    <div
      id="review-walkthrough-view"
      role="tabpanel"
      aria-labelledby="btn-review-tab-walkthrough"
      class="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
    >
      <Show when={!review.walkthrough.error && review.walkthroughData()}>
        <WalkthroughToolbar />
      </Show>
      <div class="flex min-h-0 flex-1 flex-row overflow-hidden">
        <Switch>
          <Match when={review.walkthrough.error}>
            <EmptyState icon="icon-[ph--warning-circle]" title="Failed to load walkthrough">
              <span class="text-destructive">{review.walkthrough.error.message}</span>
            </EmptyState>
          </Match>
          <Match when={review.walkthrough.loading || !review.walkthroughData()}>
            <EmptyState spinner title="Loading changed files…" />
          </Match>
          <Match when={!files().length && !review.walkthroughData()?.hiddenWhitespaceFiles}>
            <WalkthroughFiles data={review.walkthroughData()} />
            <EmptyState icon="icon-[ph--check]" title="No changes in this pull request">
              No differences found between the PR base and head.
            </EmptyState>
          </Match>
          <Match when={files().length || review.walkthroughData()?.hiddenWhitespaceFiles}>
            <WalkthroughFiles data={review.walkthroughData()} />
            <WalkthroughDiff files={visibleFiles(files(), review.groupFilter())} />
          </Match>
        </Switch>
      </div>
    </div>
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
    <div class="flex w-full shrink-0 items-center gap-2 px-3 py-2">
      <div
        class="flex min-w-0 flex-1 flex-wrap items-center gap-0.5"
        role="group"
        aria-label="Filter file groups"
      >
        <For each={chips.filter((chip) => chip.id === 'all' || counts()[chip.id])}>
          {(chip) => (
            <button
              title={chip.title}
              class="inline-flex h-6 items-center gap-1.5 rounded-[8px] px-2.25 text-12-5 whitespace-nowrap text-muted-foreground hover:text-foreground aria-pressed:bg-(--hover) aria-pressed:text-foreground"
              aria-pressed={review.groupFilter() === chip.id}
              onClick={() => editor.actions.setGroupFilter(chip.id)}
            >
              <Show when={chip.icon}>
                <span class={`${chip.icon} shrink-0`} aria-hidden="true" />
              </Show>
              {chip.label}
              <CountPill value={counts()[chip.id] ?? 0} />
            </button>
          )}
        </For>
      </div>
      <DiffOptions id="btn-walkthrough-options" />
    </div>
  );
}
function EmptyState(props: EmptyStateProps): JSX.Element {
  return (
    <div class="empty flex h-full flex-1 flex-col items-center justify-center gap-2 p-3 text-center text-muted-foreground">
      <Show
        when={props.spinner}
        fallback={<span class={`${props.icon} shrink-0`} aria-hidden="true" />}
      >
        <span class="icon-[ph--spinner] motion-safe:animate-spin" aria-hidden="true" />
      </Show>
      <h3 class="font-display font-semibold tracking-[-0.02em]">{props.title}</h3>
      <Show when={props.children}>
        <p>{props.children}</p>
      </Show>
    </div>
  );
}
