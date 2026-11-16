import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { ErrorNotice } from '../lib/ErrorNotice.tsx';
import { withKeys } from '../lib/keyboard.ts';
import { sortedByTime } from './logic.ts';
import { IssueComment } from './IssueComment.tsx';
import { CommentThread } from './CommentThread.tsx';
// Posted comments (conversation and inline) plus your drafts, for the life of the session.
export function CommentsPanel(props: { ref?: (element: HTMLDivElement) => void }): JSX.Element {
  const editor = useEditor();
  const pr = editor.pr;
  const panel = () => pr.state.panel;
  let compose: HTMLTextAreaElement | undefined;
  const both = () => pr.state.issueComments.length && pr.threads().length;
  return (
    <div
      ref={props.ref}
      id="pr-comments-panel"
      class="[body:not(.in-review-mode)_&]:hidden! group/comments relative flex min-h-min shrink flex-col overflow-hidden bg-sidebar [&.collapsed]:h-auto!"
      classList={{ collapsed: panel().collapsed }}
      style={{ height: panel().collapsed ? 'auto' : panel().height + 'px' }}
    >
      <div
        data-ui="pr-comments-panel-head"
        class="flex flex-wrap items-center shrink-0 select-none gap-2 p-3"
        aria-expanded={!panel().collapsed}
        onClick={editor.actions.togglePRPanel}
      >
        <span class="label">Comments</span>
        <Show when={pr.commentCount()}>
          <span
            id="pr-comments-count"
            class="badge"
            data-variant="secondary"
            data-control="pr-comments-count"
          >
            {pr.commentCount()}
          </span>
        </Show>
        <span class="min-w-0 flex-1" />
        <button
          type="button"
          id="pr-comments-collapse"
          title="Expand/collapse comments panel"
          aria-label="Expand/collapse comments panel"
          class="btn"
          data-control="pr-comments-collapse"
          data-variant="ghost"
          data-size="icon-xs"
        >
          <span
            class={`${panel().collapsed ? 'icon-[ph--caret-up]' : 'icon-[ph--caret-down]'} size-3.5 text-muted-foreground`}
            aria-hidden="true"
          />
        </button>
      </div>
      <Show when={!panel().collapsed}>
        <div class="flex min-h-min flex-1 flex-col">
          {/* Size the scroller from the panel, not the intrinsic height of the entire history. */}
          <div
            id="pr-comments-list"
            class="[&>*]:shrink-0 flex flex-col flex-1 min-h-16 overflow-y-auto [contain:size] gap-2 p-3"
          >
            <ErrorNotice error={pr.state.loadError} />
            <Show when={both()}>
              <div class="text-xs font-medium text-muted-foreground">Conversation</div>
            </Show>
            <For each={sortedByTime(pr.state.issueComments)}>
              {(comment) => (
                <IssueComment
                  comment={comment}
                  onReply={(author) => {
                    editor.actions.replyToAuthor(author);
                    compose?.focus();
                    if (compose)
                      compose.setSelectionRange(compose.value.length, compose.value.length);
                  }}
                />
              )}
            </For>
            <Show when={both()}>
              <div class="text-xs font-medium text-muted-foreground">On the code</div>
            </Show>
            <For each={pr.threads()}>{(thread) => <CommentThread thread={thread} />}</For>
            <Show when={!pr.commentCount() && !pr.state.loadError}>
              <div class="empty p-3 text-center text-muted-foreground">
                No comments yet. Select lines in the diff to comment on the code.
              </div>
            </Show>
          </div>
          <div data-ui="pr-comments-compose" class="flex-none p-3 pt-0">
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
                  <span class="icon-[ph--arrow-up] size-4" aria-hidden="true" />
                </button>
              </footer>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
