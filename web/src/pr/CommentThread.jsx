import { createEffect, For, on, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { ErrorNotice } from '../lib/ErrorNotice.jsx';
import { formatTime } from './logic.ts';
import { CommentBody } from './CommentBody.jsx';
export function CommentThread(props) {
  const editor = useEditor();
  const pr = editor.pr;
  const key = () => 'thread:' + props.thread.key;
  const total = () => props.thread.existing.length + props.thread.drafts.length;
  const revealed = () => pr.state.reveal.key === key();
  let item;
  // Native scroll for a gutter marker's request to show this thread.
  createEffect(
    on(
      () => pr.state.reveal.sequence,
      () => {
        if (revealed()) item.scrollIntoView({ block: 'center', behavior: 'smooth' });
      },
      { defer: true },
    ),
  );
  return (
    <details
      ref={item}
      class="card group/accordion flex flex-col gap-2! p-3!"
      classList={{ 'diff-row-flash': revealed() }}
      open={!!pr.state.expanded[key()]}
      onToggle={(event) => editor.actions.setThreadExpanded(key(), event.currentTarget.open)}
    >
      <summary class="flex min-w-0 cursor-pointer items-center gap-2">
        <span
          class="icon-[lucide--chevron-right] size-3.5 shrink-0 text-muted-foreground group-open/accordion:rotate-90"
          aria-hidden="true"
        />
        <button
          type="button"
          class="inline-flex w-fit cursor-pointer items-center gap-2 font-mono text-primary-text"
          onClick={(event) => {
            event.preventDefault();
            void editor.actions.openFile(props.thread.path, { line: props.thread.line });
          }}
        >
          {props.thread.path}:{props.thread.line}
          {props.thread.side === 'LEFT' ? ' (base)' : ''}
        </button>
        <span>{props.thread.root ? props.thread.root.author || 'unknown' : 'you'}</span>
        <Show when={total() > 1}>
          <span class="badge" data-variant="secondary">
            {total()}
          </span>
        </Show>
        <span class="flex-1 truncate text-muted-foreground group-open/accordion:hidden">
          {props.thread.root?.body || props.thread.drafts[0]?.body || ''}
        </span>
      </summary>
      <div class="flex flex-col gap-2">
        <For each={props.thread.existing}>
          {(comment) => (
            <div class="card flex flex-col gap-2! p-3!" classList={{ 'ml-4': !!comment.inReplyTo }}>
              <div class="flex min-w-0 items-baseline gap-2">
                <span class="font-medium">{comment.author || 'unknown'}</span>
                <span class="text-muted-foreground">{formatTime(comment.createdAt)}</span>
              </div>
              <CommentBody comment={comment} />
            </div>
          )}
        </For>
        <For each={props.thread.drafts}>{(draft) => <DraftCard draft={draft} />}</For>
        <Show when={props.thread.root}>
          <ReplyRow rootId={props.thread.root.id} />
        </Show>
      </div>
    </details>
  );
}
function DraftCard(props) {
  const editor = useEditor();
  return (
    <div class="card flex flex-col gap-2! border-dashed p-3!">
      <div class="flex min-w-0 items-baseline gap-2">
        <span>You (draft, not yet submitted)</span>
      </div>
      <CommentBody comment={props.draft} />
      <div class="flex gap-2">
        <button
          type="button"
          class="btn"
          data-variant="ghost"
          data-size="icon-xs"
          title="Delete draft"
          aria-label="Delete draft"
          disabled={!!editor.pr.state.deleting[props.draft.id]}
          onClick={() => void editor.actions.deleteDraft(props.draft.id)}
        >
          <span class="icon-[lucide--trash-2] size-3.5 shrink-0" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
function ReplyRow(props) {
  const editor = useEditor();
  const reply = () =>
    editor.pr.state.replies[props.rootId] || { body: '', pending: false, error: '' };
  return (
    <div class="flex flex-col gap-1">
      <div class="flex items-start gap-2">
        <textarea
          rows="1"
          spellcheck={false}
          autocomplete="off"
          placeholder="Reply..."
          aria-label="Reply"
          class="textarea resize-y"
          value={reply().body}
          onInput={(event) => editor.actions.setReplyBody(props.rootId, event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
            event.preventDefault();
            void editor.actions.sendReply(props.rootId);
          }}
        />
        <button
          class="btn"
          data-variant="ghost"
          data-size="xs"
          disabled={reply().pending || !reply().body.trim()}
          onClick={() => void editor.actions.sendReply(props.rootId)}
        >
          {reply().pending ? 'Replying…' : 'Reply'}
        </button>
      </div>
      <ErrorNotice error={reply().error} />
    </div>
  );
}
