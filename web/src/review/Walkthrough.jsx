import { Match, Show, Switch } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { WalkthroughFiles } from './WalkthroughFiles.jsx';
import { WalkthroughDiff } from './WalkthroughDiff.jsx';
export function Walkthrough() {
  const review = useEditor().review;
  const files = () => review.walkthroughData()?.files || [];
  return (
    <div id="review-walkthrough-view" class="flex h-full min-h-0 flex-1 flex-row overflow-hidden">
      <Switch>
        <Match when={review.walkthrough.error}>
          <EmptyState icon="icon-[lucide--circle-alert]" title="Failed to load code understanding">
            <span class="text-destructive">{review.walkthrough.error.message}</span>
          </EmptyState>
        </Match>
        <Match when={!review.walkthroughData()}>
          <EmptyState spinner title="Analyzing code changes & guardrails…" />
        </Match>
        <Match when={!files().length}>
          <EmptyState icon="icon-[lucide--check]" title="Working tree is clean">
            No modified files or uncommitted diffs found against{' '}
            {review.walkthroughData().baseRef || 'HEAD'}.
          </EmptyState>
        </Match>
        <Match when={files().length}>
          <WalkthroughFiles data={review.walkthroughData()} />
          <WalkthroughDiff files={files()} />
        </Match>
      </Switch>
    </div>
  );
}
function EmptyState(props) {
  return (
    <div class="empty flex h-full flex-1 flex-col items-center justify-center gap-2 p-3 text-center text-muted-foreground">
      <Show
        when={props.spinner}
        fallback={<span class={`${props.icon} size-4 shrink-0`} aria-hidden="true" />}
      >
        <div class="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
      </Show>
      <h3>{props.title}</h3>
      <Show when={props.children}>
        <p>{props.children}</p>
      </Show>
    </div>
  );
}
