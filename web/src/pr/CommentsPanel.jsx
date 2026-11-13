import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { SplitHandle } from '../lib/SplitHandle.jsx';
import { ErrorNotice } from '../lib/ErrorNotice.jsx';
import { withKeys } from '../lib/keyboard.ts';
import { sortedByTime } from './logic.ts';
import { IssueComment } from './IssueComment.jsx';
import { CommentThread } from './CommentThread.jsx';
// Posted comments (conversation and inline) plus your drafts, for the life of the session.
export function CommentsPanel() {
  const editor = useEditor();
  const pr = editor.pr;
  const panel = () => pr.state.panel;
  let compose;
  const both = () => pr.state.issueComments.length && pr.threads().length;
  return (
    <div
      id="pr-comments-panel"
      class="relative flex max-h-[80vh] shrink-0 flex-col border-t"
      style={{ height: panel().collapsed ? 'auto' : panel().height + 'px' }}
    >
      <div class="absolute inset-x-0 -top-1">
        <SplitHandle
          vertical
          reverse
          label="Comments panel height"
          value={panel().height}
          min={80}
          max={Math.round(window.innerHeight * 0.8)}
          onChange={editor.actions.setPRPanelHeight}
        />
      </div>
      <button
        type="button"
        class="flex shrink-0 items-center gap-2 p-3 text-left select-none"
        aria-expanded={!panel().collapsed}
        onClick={editor.actions.togglePRPanel}
      >
        <span class="label">Comments</span>
        <Show when={pr.commentCount()}>
          <span id="pr-comments-count" class="badge" data-variant="secondary">
            {pr.commentCount()}
          </span>
        </Show>
        <span class="min-w-0 flex-1" />
        <span
          class={`${panel().collapsed ? 'icon-[lucide--chevron-up]' : 'icon-[lucide--chevron-down]'} size-3.5 text-muted-foreground`}
          aria-hidden="true"
        />
      </button>
      <Show when={!panel().collapsed}>
        <div class="flex min-h-0 flex-1 flex-col">
          <div
            id="pr-comments-list"
            class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 *:shrink-0"
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
                    compose.focus();
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
          <div class="flex-none p-3 pt-0">
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
                  class="btn rounded-full"
                  data-variant="primary"
                  data-size="icon-sm"
                  onClick={() => void editor.actions.sendIssueComment()}
                >
                  <span class="icon-[lucide--arrow-up] size-4" aria-hidden="true" />
                </button>
              </footer>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
