import { onMount, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { keyLabel } from '../lib/keyboard.ts';
// A draft review comment on one diff line.
export function PRComposer(props) {
  const editor = useEditor();
  const modEnter = keyLabel('Mod+Enter');
  let input;
  // Only a newly opened composer takes focus, not one scrolled back into view.
  onMount(() => {
    if (editor.pr.state.focus !== props.composer.id) return;
    input.focus();
    editor.actions.composerFocused();
  });
  return (
    <div class="card flex w-96 max-w-full flex-col gap-2 p-4" data-composer={props.composer.id}>
      <div class="flex items-center gap-2 font-mono">
        <span class="sel-chip">Review Comment</span>
        <button
          type="button"
          title="Jump to this line"
          class="btn"
          data-variant="ghost"
          data-size="xs"
          onClick={() => void editor.actions.revealComposer(props.composer.id)}
        >
          {props.composer.label}
        </button>
        <span class="min-w-0 flex-1" />
        <button
          type="button"
          title="Close (Esc)"
          aria-label="Close (Esc)"
          class="btn"
          data-variant="ghost"
          data-size="icon-xs"
          onClick={() => editor.actions.closeComposer(props.composer.id)}
        >
          <span class="icon-[lucide--x] size-3.5" aria-hidden="true" />
        </button>
      </div>
      <textarea
        ref={input}
        rows="3"
        spellcheck={false}
        autocomplete="off"
        aria-label="Review comment"
        placeholder={`Leave a comment on this line... (${modEnter} to add)`}
        class="textarea resize-y"
        value={props.composer.body}
        onInput={(event) =>
          editor.actions.setComposerBody(props.composer.id, event.currentTarget.value)
        }
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            editor.actions.closeComposer(props.composer.id);
          } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void editor.actions.sendComposer(props.composer.id);
          }
        }}
      />
      <Show when={props.composer.error}>
        <div role="alert" class="alert p-3 font-mono text-destructive">
          {props.composer.error}
        </div>
      </Show>
      <div class="flex items-center gap-2 font-mono text-muted-foreground">
        <span class="flex-1 text-xs">{modEnter} to add, Esc to cancel</span>
        <button
          type="button"
          title={`Add comment (${modEnter})`}
          class="btn"
          data-variant="primary"
          data-size="xs"
          disabled={props.composer.pending || !props.composer.body.trim()}
          onClick={() => void editor.actions.sendComposer(props.composer.id)}
        >
          {props.composer.pending ? 'Adding…' : 'Add Comment'}
        </button>
      </div>
    </div>
  );
}
