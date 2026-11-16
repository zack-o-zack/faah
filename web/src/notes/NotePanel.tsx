import type { JSX } from 'solid-js';
import type { NoteView, NotesAPI } from './store.ts';
import { createSignal, onMount, onCleanup, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { refreshTarget } from './targets.ts';
import { Markdown } from '../lib/Markdown.tsx';

/** Editor annotation: measured in the source flow, outside the file text. */
export function NotePanel(props: {
  id: string;
  note: NoteView;
  notes?: NotesAPI;
  review?: boolean;
}): JSX.Element {
  const editor = useEditor();
  const notes = () => props.notes || editor.notes;
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  let panel: HTMLElement | undefined;
  onMount(() => {
    if (!panel || props.review) return;
    const measure = () =>
      notes().measureDetail(props.note, panel?.getBoundingClientRect().height || 0);
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    measure();
    onCleanup(() => observer.disconnect());
  });
  async function dismiss() {
    setBusy(true);
    setError('');
    try {
      await notes().dismiss(props.note);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not dismiss note');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      ref={panel}
      id={props.id}
      data-note-panel
      aria-label="Explanation detail"
      class="rounded-xl shadow-pop border-y border-special/20 bg-special/5 px-3 py-2 text-xs leading-5 font-sans text-foreground wrap-anywhere"
    >
      <Markdown
        text={props.note.detail}
        refs={props.note.links}
        onOpen={(target) =>
          props.review
            ? void editor.actions.openReviewReference(target)
            : void editor.actions.openFile(target.path, { line: target.line })
        }
      />
      <Show when={error()}>
        <p role="alert" class="text-destructive">
          {error()}
        </p>
      </Show>
      <footer class="mt-2 flex items-center gap-1">
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
            data-variant="ghost"
            data-size="xs"
            onClick={() =>
              void editor.actions.explainSelection(
                props.review
                  ? {
                      path: props.note.path,
                      l1: props.note.l1,
                      l2: props.note.l2,
                      symbol: props.note.symbol,
                    }
                  : refreshTarget(props.note, (index) => editor.buffer()?.text(index) || ''),
                true,
              )
            }
          >
            Refresh
          </button>
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
      </footer>
    </section>
  );
}
