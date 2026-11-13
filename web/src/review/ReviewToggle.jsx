import { onCleanup, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { createShortcut } from '../lib/shortcuts.jsx';
import { withKeys } from '../lib/keyboard.js';
import { REVIEW_HELP } from '../shortcuts/help.ts';
// The top bar's way into the overview, and back to the editor while it shows.
export function ReviewToggle() {
  const editor = useEditor();
  const review = editor.review;
  const pr = () => editor.store.state.workspace.meta?.pr;
  createShortcut('Mod+Shift+V', () => editor.actions.toggleReviewMode(), { inputs: true });
  onCleanup(editor.shortcuts.describe(REVIEW_HELP));
  return (
    <Show
      when={review.state.mode === 'review'}
      fallback={
        <button
          type="button"
          id="btn-pr-toggle"
          title={withKeys('Changed files, review pipeline and PR comments ({Mod+Shift+V})')}
          class="btn"
          data-variant="primary"
          data-size="xs"
          onClick={() => editor.actions.setReviewMode('review')}
        >
          <Show
            when={pr()}
            fallback={
              <>
                <span class="icon-[lucide--list-checks] size-3.5 shrink-0" aria-hidden="true" />
                <span>Overview</span>
              </>
            }
          >
            <span class="icon-[lucide--git-pull-request] size-3.5 shrink-0" aria-hidden="true" />
            <span>
              PR <span class="tabular-nums">#{pr().number}</span>
            </span>
          </Show>
          <Show when={review.running()}>
            <span
              class="size-1.5 shrink-0 animate-pulse rounded-full bg-warn"
              title="Review pipeline running"
            />
          </Show>
        </button>
      }
    >
      <button
        type="button"
        id="btn-pr-close"
        title={withKeys('Back to the editor ({Mod+Shift+V})')}
        class="btn"
        data-variant="primary"
        data-size="xs"
        onClick={() => editor.actions.setReviewMode('code')}
      >
        <span class="icon-[lucide--arrow-left] size-3.5 shrink-0" aria-hidden="true" />
        <span>Back to editor</span>
      </button>
    </Show>
  );
}
