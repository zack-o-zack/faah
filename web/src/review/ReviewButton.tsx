import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { withKeys } from '../lib/keyboard.ts';

// A fixed footer outside the Git panel's scroll area, including non-Git workspaces.
export function ReviewButton(): JSX.Element {
  const editor = useEditor();
  return (
    <Show
      when={
        editor.tree.mode() === 'git' &&
        editor.review.state.mode === 'code' &&
        !editor.store.state.workspace.meta?.pr
      }
    >
      <div class="shrink-0 border-t p-3">
        <button
          type="button"
          id="btn-review"
          title={withKeys('Changed files, review pipeline and PR comments ({Mod+Shift+V})')}
          class="btn w-full"
          data-variant="outline"
          data-size="sm"
          onClick={() => editor.actions.setReviewMode('review')}
        >
          <span class="icon-[lucide--list-checks] size-3.5 shrink-0" aria-hidden="true" />
          <span>Review</span>
          <Show when={editor.review.running()}>
            <span
              class="size-1.5 shrink-0 animate-pulse rounded-full bg-warn"
              title="Review pipeline running"
            />
          </Show>
        </button>
      </div>
    </Show>
  );
}
