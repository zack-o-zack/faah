import type { JSX } from 'solid-js';
import { createMemo, For, Match, Show, Switch } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { ErrorNotice } from '../lib/ErrorNotice.tsx';
import { withKeys } from '../lib/keyboard.ts';
import { CountPill } from '../review/CountPill.tsx';
import { CommentThread } from './CommentThread.tsx';
import { IssueComment } from './IssueComment.tsx';
import type { ActivityItem } from './logic.ts';
import { activityItems } from './logic.ts';
// The pull request's conversation and review threads in time order, then a box to add to it.
export function Activity(): JSX.Element {
  const editor = useEditor();
  const pr = editor.pr;
  const items = createMemo(() => activityItems(pr.state.issueComments, pr.threads()));
  let compose: HTMLTextAreaElement | undefined;
  const reply = (author: string) => {
    editor.actions.replyToAuthor(author);
    compose?.focus();
    if (compose) compose.setSelectionRange(compose.value.length, compose.value.length);
  };
  return (
    <section aria-label="Activity" class="mt-3.5 border-t border-border pt-3">
      <h2 class="mb-2 flex items-center gap-1.5 text-12 font-medium text-muted-foreground">
        Activity
        <CountPill value={items().length} />
      </h2>
      <ErrorNotice error={pr.state.loadError} />
      <Show
        when={items().length}
        fallback={
          <Show when={!pr.state.loadError}>
            <p class="text-sm text-muted-foreground">
              No comments yet. Select lines in the diff to comment on the code.
            </p>
          </Show>
        }
      >
        <For each={items()}>{(item) => <ActivityEntry item={item} onReply={reply} />}</For>
      </Show>
      <div data-ui="pr-activity-compose" class="mt-3.5 flex flex-col gap-1.5">
        <ErrorNotice error={pr.state.issue.error} />
        <div class="input-group" data-orientation="vertical">
          <textarea
            id="pr-issue-compose-body"
            ref={compose}
            aria-label="Pull request comment"
            rows="1"
            spellcheck={false}
            autocomplete="off"
            placeholder="Comment on this pull request"
            class="max-h-40 min-h-9"
            value={pr.state.issue.body}
            onInput={(event) => editor.actions.setIssueBody(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
              event.preventDefault();
              void editor.actions.sendIssueComment();
            }}
            data-control="pr-review-body"
          />
          <footer data-align="block-end" class="gap-1">
            <span class="text-xs text-muted-foreground">Markdown supported</span>
            <span class="flex-1" />
            <button
              id="pr-issue-compose-send"
              type="button"
              disabled={!pr.state.issue.body.trim() || pr.state.issue.pending}
              title={withKeys('Post comment ({Mod+Enter})')}
              aria-label="Post comment"
              class="btn"
              data-variant="primary"
              data-size="icon-sm"
              onClick={() => void editor.actions.sendIssueComment()}
            >
              <span class="icon-[ph--arrow-up]" aria-hidden="true" />
            </button>
          </footer>
        </div>
      </div>
    </section>
  );
}
function ActivityEntry(props: {
  item: ActivityItem;
  onReply: (author: string) => void;
}): JSX.Element {
  return (
    <div class="flex gap-2.5 py-1.5" data-ui="pr-activity-item" data-kind={props.item.kind}>
      <span
        class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-border bg-muted text-13 text-muted-foreground"
        aria-hidden="true"
      >
        <span class={props.item.kind === 'issue' ? 'icon-[ph--chat-circle]' : 'icon-[ph--eye]'} />
      </span>
      <div class="min-w-0 flex-1">
        <Switch>
          <Match when={props.item.kind === 'issue' ? props.item.comment : undefined}>
            {(comment) => <IssueComment comment={comment()} onReply={props.onReply} />}
          </Match>
          <Match when={props.item.kind === 'thread' ? props.item.thread : undefined}>
            {(thread) => <CommentThread thread={thread()} />}
          </Match>
        </Switch>
      </div>
    </div>
  );
}
