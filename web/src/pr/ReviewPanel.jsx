import { Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { Popover } from '../lib/Popover.tsx';
import { ErrorNotice } from '../lib/ErrorNotice.tsx';
import { draftsNote, forgeInfo, prEnded } from './logic.ts';
// One panel holds the summary and the verdict that sends it.
export function ReviewPanel() {
  const editor = useEditor();
  const pr = () => editor.pr.state;
  const meta = () => editor.pr.meta();
  const gate = () => editor.merge.gate();
  const verdicts = () => meta().writeAccess && !prEnded(meta());
  return (
    <Popover
      triggerId="pr-review-toggle"
      variant="outline"
      size="sm"
      label={
        <>
          <span class="icon-[lucide--message-square-text] size-3.5 shrink-0" aria-hidden="true" />
          Review
          <Show when={pr().drafts.length}>
            <span class="badge tabular-nums" data-variant="secondary">
              {pr().drafts.length}
            </span>
          </Show>
          <span class="icon-[lucide--chevron-down] size-3.5 shrink-0 text-muted-foreground" />
        </>
      }
      accessibleLabel="Send a review"
      open={pr().review.open}
      onOpenChange={editor.actions.setReviewPanel}
    >
      <div class="flex w-[min(28rem,90vw)] flex-col gap-3 p-2">
        <label class="flex flex-col gap-1.5">
          <span class="text-xs font-medium">
            Summary <span class="font-normal text-muted-foreground">(optional)</span>
          </span>
          <textarea
            id="pr-review-body"
            aria-label="Review summary"
            rows="4"
            placeholder="Overall feedback. It shows above your line comments on the pull request."
            class="textarea min-h-24 max-h-72 resize-y"
            value={pr().review.body}
            onInput={(event) => editor.actions.setReviewBody(event.currentTarget.value)}
            data-control="pr-review-body"
          />
        </label>
        <p class="text-xs text-muted-foreground">{draftsNote(pr().drafts.length)}</p>
        <ErrorNotice error={pr().review.error} />
        <div class="flex flex-col gap-1.5" role="group" aria-label="Send as">
          <Verdict
            id="pr-submit-comment"
            event="COMMENT"
            icon="icon-[lucide--message-square]"
            label="Comment"
            hint="Submit general feedback without explicit approval"
            disabled={gate().all}
            title={
              gate().all ||
              (meta().readOnly
                ? `No ${forgeInfo(editor.store.state.workspace.meta).label} token configured -- click to connect and submit`
                : 'Submit review with drafts, without approval or change requests')
            }
            class="flex w-full items-start gap-2.5 rounded-md border px-3 py-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
          />
          <Show when={verdicts()}>
            <Verdict
              id="pr-submit-approve"
              event="APPROVE"
              icon="icon-[lucide--check] text-gi"
              label="Approve"
              hint={gate().approveNote || 'Submit feedback and approve merging these changes'}
              disabled={gate().all || gate().approve}
              title={gate().all || gate().approve || gate().approveNote || 'Approve this PR'}
              class="flex w-full items-start gap-2.5 rounded-md border px-3 py-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
            />
            <Verdict
              id="pr-submit-request-changes"
              event="REQUEST_CHANGES"
              icon="icon-[lucide--file-diff] text-destructive"
              label="Request changes"
              hint="Submit feedback that must be addressed before merging"
              disabled={gate().all}
              title={gate().all || 'Request changes on this PR'}
              class="flex w-full items-start gap-2.5 rounded-md border px-3 py-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
            />
          </Show>
        </div>
      </div>
    </Popover>
  );
}
function Verdict(props) {
  const editor = useEditor();
  const pending = () => editor.pr.state.review.pending;
  return (
    <button
      id={props.id}
      type="button"
      title={props.title}
      disabled={!!props.disabled || !!pending()}
      class="flex w-full items-start gap-2.5 rounded-md border px-3 py-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
      onClick={() => void editor.actions.submitReview(props.event)}
    >
      <span class={`${props.icon} mt-0.5 size-4 shrink-0`} aria-hidden="true" />
      <span class="flex min-w-0 flex-col gap-0.5">
        <span class="text-sm font-medium">
          {pending() === props.event ? 'Sending…' : props.label}
        </span>
        <span class="text-xs text-muted-foreground">{props.hint}</span>
      </span>
    </button>
  );
}
