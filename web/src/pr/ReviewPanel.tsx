import type { JSX } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { OptionButton } from './OptionButton.tsx';
import { Popover } from '../lib/Popover.tsx';
import { ErrorNotice } from '../lib/ErrorNotice.tsx';
import { draftsNote, forgeInfo, prEnded } from './logic.ts';
// One panel holds the summary and the verdict that sends it.
export function ReviewPanel(): JSX.Element {
  const editor = useEditor();
  const pr = () => editor.pr.state;
  const meta = () => editor.pr.meta() || {};
  const gate = () => editor.merge.gate();
  const verdicts = () => meta()?.writeAccess && !prEnded(meta());
  type Verdict = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
  const [selected, setSelected] = createSignal<Verdict>('COMMENT');
  const blocked = () =>
    gate().all ||
    (selected() === 'APPROVE' && gate().approve) ||
    (selected() !== 'COMMENT' && !verdicts());
  const hint = () => {
    if (selected() === 'APPROVE')
      return gate().approveNote || 'Submit feedback and approve merging these changes';
    if (selected() === 'REQUEST_CHANGES')
      return 'Submit feedback that must be addressed before merging';
    return 'Submit general feedback without explicit approval';
  };
  return (
    <Popover
      triggerId="pr-review-toggle"
      onOpen={() => setSelected('COMMENT')}
      panelClass="fixed z-[70] m-0 w-[min(28rem,calc(100vw-1rem))] min-w-0 top-auto left-auto gap-0"
      variant="outline"
      size="sm"
      label={
        <>
          <span class="icon-[ph--chat-centered-text] size-3.5 shrink-0" aria-hidden="true" />
          Review
          <Show when={pr().drafts.length}>
            <span class="badge tabular-nums" data-variant="secondary">
              {pr().drafts.length}
            </span>
          </Show>
          <span class="icon-[ph--caret-down] size-3.5 shrink-0 text-muted-foreground" />
        </>
      }
      accessibleLabel="Send a review"
      open={pr().review.open}
      onOpenChange={editor.actions.setReviewPanel}
    >
      <div class="flex min-w-0 w-full flex-col gap-3 p-2">
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
        <div class="button-group flex w-full gap-0" role="radiogroup" aria-label="Review verdict">
          <OptionButton
            selected={selected() === 'COMMENT'}
            label="Comment"
            icon="icon-[ph--chat-centered]"
            disabled={!!gate().all || !!pr().review.pending}
            title={
              gate().all ||
              (meta().readOnly
                ? `No ${forgeInfo(editor.store.state.workspace.meta).label} token configured, click to connect and submit`
                : 'Submit general feedback')
            }
            onClick={() => setSelected('COMMENT')}
          />
          <Show when={verdicts()}>
            <OptionButton
              selected={selected() === 'APPROVE'}
              label="Approve"
              icon="icon-[ph--check] text-gi"
              disabled={!!gate().all || !!gate().approve || !!pr().review.pending}
              title={gate().all || gate().approve || gate().approveNote || 'Approve this PR'}
              onClick={() => setSelected('APPROVE')}
            />
            <OptionButton
              selected={selected() === 'REQUEST_CHANGES'}
              label="Request changes"
              icon="icon-[ph--git-diff] text-destructive"
              disabled={!!gate().all || !!pr().review.pending}
              title={gate().all || 'Request changes on this PR'}
              onClick={() => setSelected('REQUEST_CHANGES')}
            />
          </Show>
        </div>
        <p class="text-xs text-muted-foreground">{hint()}</p>
        <button
          id="pr-review-submit"
          type="button"
          class="btn w-full"
          data-variant="primary"
          disabled={!!blocked() || !!pr().review.pending}
          title={typeof blocked() === 'string' ? String(blocked()) : undefined}
          onClick={() => void editor.actions.submitReview(selected())}
        >
          {pr().review.pending ? 'Sending…' : 'Submit review'}
        </button>
      </div>
    </Popover>
  );
}
