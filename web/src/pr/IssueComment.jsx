import { useEditor } from '../editor/context.jsx';
import { commentPreview, formatTime } from './logic.ts';
import { CommentBody } from './CommentBody.jsx';
export function IssueComment(props) {
  const editor = useEditor();
  const key = () => 'issue:' + props.comment.id;
  return (
    <details
      class="card group/accordion flex flex-col gap-0! px-3! py-2!"
      open={!!editor.pr.state.expanded[key()]}
      onToggle={(event) => editor.actions.setThreadExpanded(key(), event.currentTarget.open)}
    >
      <summary class="flex min-w-0 cursor-pointer items-center gap-2">
        <span
          class="icon-[lucide--chevron-right] size-3.5 shrink-0 text-muted-foreground group-open/accordion:rotate-90"
          aria-hidden="true"
        />
        <span class="shrink-0 font-medium">{props.comment.author || 'unknown'}</span>
        <span class="shrink-0 text-muted-foreground">{formatTime(props.comment.createdAt)}</span>
        <span class="min-w-0 flex-1 truncate text-muted-foreground group-open/accordion:hidden">
          {commentPreview(props.comment.body)}
        </span>
        <button
          type="button"
          class="btn ms-auto"
          data-variant="ghost"
          data-size="icon-xs"
          title="Reply"
          aria-label="Reply"
          onClick={(event) => {
            // It sits in the summary: reply, don't fold.
            event.preventDefault();
            props.onReply(props.comment.author || '');
          }}
        >
          <span class="icon-[lucide--reply] size-3.5 shrink-0" aria-hidden="true" />
        </button>
      </summary>
      <div class="mt-2 flex flex-col gap-2">
        <CommentBody comment={props.comment} />
      </div>
    </details>
  );
}
