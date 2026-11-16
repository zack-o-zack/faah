interface EmptyStateProps {
  icon?: string;
  spinner?: boolean;
  title: string;
  children?: JSX.Element;
}
import type { JSX } from 'solid-js';
import { Match, Show, Switch } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { visibleFiles } from './logic.ts';
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
      class="flex h-full min-h-0 flex-1 flex-row overflow-hidden"
    >
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
  );
}
function EmptyState(props: EmptyStateProps): JSX.Element {
  return (
    <div class="empty flex h-full flex-1 flex-col items-center justify-center gap-2 p-3 text-center text-muted-foreground">
      <Show
        when={props.spinner}
        fallback={<span class={`${props.icon} shrink-0`} aria-hidden="true" />}
      >
        <div class="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
      </Show>
      <h3 class="font-display font-semibold tracking-[-0.02em]">{props.title}</h3>
      <Show when={props.children}>
        <p>{props.children}</p>
      </Show>
    </div>
  );
}
