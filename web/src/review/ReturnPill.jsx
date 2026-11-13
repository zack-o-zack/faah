import { Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { withKeys } from '../lib/keyboard.js';
export function ReturnPill() {
  const editor = useEditor();
  const review = editor.review;
  return (
    <Show when={review.state.mode === 'code' && review.state.returnTo}>
      <div
        id="review-return-pill"
        class="card fixed right-6 bottom-12 z-50 flex flex-row items-center gap-2 p-3"
      >
        <span class="icon-[lucide--corner-up-left] size-3.5 shrink-0 text-primary-text" />
        <span>Jumped from: {review.state.returnTo.title}</span>
        <button
          id="btn-return-to-review"
          title={withKeys('Back to the overview ({Mod+Shift+V})')}
          class="btn"
          data-variant="outline"
          data-size="xs"
          onClick={() => editor.actions.setReviewMode('review')}
        >
          Back to overview
        </button>
        <button
          id="btn-dismiss-review-return"
          title="Dismiss"
          aria-label="Dismiss"
          class="btn"
          data-variant="ghost"
          data-size="icon-xs"
          onClick={editor.actions.dismissReviewReturn}
        >
          <span class="icon-[lucide--x] size-3.5 shrink-0" aria-hidden="true" />
        </button>
      </div>
    </Show>
  );
}
