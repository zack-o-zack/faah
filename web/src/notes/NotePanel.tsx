import type { JSX } from 'solid-js';
import { createSignal, onMount } from 'solid-js';
import type { NoteView } from './store.ts';
import { useEditor } from '../editor/context.tsx';
import { Markdown } from '../lib/Markdown.tsx';

/** Editor annotation detail: prefer above the summary, staying inside the scroll viewport. */
export function NotePanel(props: { id: string; note: NoteView; review?: boolean }): JSX.Element {
  const editor = useEditor();
  const [side, setSide] = createSignal<'top' | 'bottom'>('top');
  let wrapper: HTMLDivElement | undefined;
  onMount(() => {
    if (!wrapper) return;
    const summary = wrapper.parentElement?.querySelector('[data-note-inline]');
    const viewport = wrapper.closest('#viewport, #review-diff-pane');
    if (summary && viewport) {
      const room = summary.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
      if (room < wrapper.getBoundingClientRect().height) setSide('bottom');
    }
  });
  return (
    <div
      ref={wrapper}
      data-side={side()}
      class={`absolute left-0 z-30 ${side() === 'top' ? 'bottom-full pb-1' : 'top-full pt-1'}`}
      style={{ 'max-width': 'min(40rem, 100%)' }}
    >
      <section
        id={props.id}
        data-note-panel
        aria-label="Explanation detail"
        class="rounded-[var(--radius-md)] border px-3 py-2 font-sans text-xs leading-5 text-popover-foreground shadow-pop wrap-anywhere"
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
