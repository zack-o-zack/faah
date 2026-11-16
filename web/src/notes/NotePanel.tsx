import type { JSX } from 'solid-js';
import type { NoteView } from './store.ts';
import { useEditor } from '../editor/context.tsx';
import { Markdown } from '../lib/Markdown.tsx';

/** Editor annotation detail: a tooltip card under its summary, over the file text. */
export function NotePanel(props: { id: string; note: NoteView; review?: boolean }): JSX.Element {
  const editor = useEditor();
  return (
    <div class="absolute top-full left-0 z-30 pt-1" style={{ 'max-width': 'min(40rem, 100%)' }}>
      <section
        id={props.id}
        data-note-panel
        aria-label="Explanation detail"
        class="rounded-[var(--radius-md)] border bg-popover px-3 py-2 font-sans text-xs leading-5 text-popover-foreground shadow-pop wrap-anywhere"
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
      </section>
    </div>
  );
}
