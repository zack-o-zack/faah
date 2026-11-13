import { useEditor } from '../editor/context.jsx';
// Follow-up questions about a stage go to that stage's thread.
export function ReviewCompose() {
  const editor = useEditor();
  const review = editor.review;
  const canSend = () =>
    !!review.state.followup.trim() && !!review.active()?.threadId && !review.state.pending;
  return (
    <div class="px-4 pb-3">
      <div class="input-group" data-orientation="vertical">
        <textarea
          id="review-compose-input"
          aria-label="Follow-up about this stage"
          rows="1"
          spellcheck={false}
          autocomplete="off"
          placeholder="Ask a follow-up about this stage"
          class="max-h-40 min-h-9"
          value={review.state.followup}
          onInput={(event) => editor.actions.setReviewFollowup(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return;
            event.preventDefault();
            void editor.actions.sendReviewFollowup();
          }}
          data-control="agent-input review-input"
        />
        <footer data-align="block-end" class="gap-1">
          <span class="text-xs text-muted-foreground">
            Enter to send · Shift+Enter for a new line
          </span>
          <span class="flex-1" />
          <button
            id="review-compose-send"
            type="button"
            disabled={!canSend()}
            title="Send (Enter)"
            aria-label="Send"
            class="btn rounded-full"
            data-variant="primary"
            data-size="icon-sm"
            onClick={() => void editor.actions.sendReviewFollowup()}
          >
            <span class="icon-[lucide--arrow-up] size-4" aria-hidden="true" />
          </button>
        </footer>
      </div>
    </div>
  );
}
