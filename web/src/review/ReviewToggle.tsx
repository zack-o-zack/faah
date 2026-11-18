import type { JSX } from 'solid-js';
import { onCleanup, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { createShortcut } from '../lib/shortcuts.tsx';
import { withKeys } from '../lib/keyboard.ts';
import { REVIEW_HELP } from '../shortcuts/help.ts';
// Only PR workspaces expose the review entry, shortcut and help entry.
export function ReviewToggle(): JSX.Element {
  const editor = useEditor();
  return (
    <Show when={editor.store.state.workspace.meta?.pr}>
      <PRReviewToggle />
    </Show>
  );
}
function PRReviewToggle(): JSX.Element {
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
          <span class="icon-[ph--git-pull-request] shrink-0" aria-hidden="true" />
          <span>
            PR <span class="tabular-nums">#{pr()?.number}</span>
          </span>
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
        <span class="icon-[ph--arrow-left] shrink-0" aria-hidden="true" />
        <span>Back to editor</span>
      </button>
    </Show>
  );
}
