import type { JSX } from 'solid-js';
import type { NoteView } from './store.ts';
import { createSignal, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { refreshTarget } from './targets.ts';
import { Markdown } from '../lib/Markdown.tsx';
export function NoteCard(props: { note: NoteView }): JSX.Element {
  const editor = useEditor();
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  async function dismiss() {
    setBusy(true);
    setError('');
    try {
      await editor.notes.dismiss(props.note);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not dismiss note');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      data-note-card
      class="card gap-2 p-3 text-xs font-sans text-foreground max-h-[min(400px,60vh)] overflow-auto"
    >
      <div class="flex items-center gap-2">
        <span class="badge" data-variant="secondary">
          AI explanation
        </span>
        <Show when={props.note.stale}>
          <span class="text-warn">
            {props.note.stale === 'refs' ? 'may be outdated' : 'outdated'}
          </span>
        </Show>
        <button
          class="btn ml-auto"
          data-variant="ghost"
          data-size="icon-xs"
          aria-label="Dismiss note"
          disabled={busy()}
          onClick={() => void dismiss()}
        >
          <span class="icon-[lucide--x] size-3" />
        </button>
      </div>
      <strong class="text-special">{props.note.summary}</strong>
      <Markdown
        text={props.note.detail}
        refs={props.note.links}
        onOpen={(target) => void editor.actions.openFile(target.path, { line: target.line })}
      />
      <Show when={error()}>
        <p role="alert" class="text-destructive">
          {error()}
        </p>
      </Show>
      <div class="flex gap-2">
        <button
          class="btn"
          data-variant="ghost"
          data-size="xs"
          onClick={() => void editor.actions.openThread(props.note.thread)}
        >
          Open thread
        </button>
        <Show when={props.note.stale}>
          <button
            class="btn"
            data-variant="outline"
            data-size="xs"
            onClick={() =>
              void editor.actions.explainSelection(
                refreshTarget(props.note, (index) => editor.buffer()?.text(index) || ''),
                true,
              )
            }
          >
            Refresh
          </button>
        </Show>
      </div>
    </div>
  );
}
