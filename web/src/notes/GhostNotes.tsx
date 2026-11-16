import type { JSX } from 'solid-js';
import { For, Show, createUniqueId, onCleanup } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { NotePanel } from './NotePanel.tsx';
import { GHOST_PADDING_TOP, GHOST_PADDING_BOTTOM, ghostIndent } from './layout.ts';
import { noteKey, type NoteView, type NotesAPI } from './store.ts';

export function NoteGhost(props: {
  note: NoteView;
  indent?: number;
  notes: NotesAPI;
  rowHeight?: number;
  width?: number;
  review?: boolean;
}): JSX.Element {
  const editor = useEditor();
  const id = createUniqueId();
  const open = () => props.notes.expanded() === props.note;
  function clearHover() {
    const current = props.notes.hovered();
    if (current && noteKey(current) === noteKey(props.note)) props.notes.setHovered(null);
  }
  // The detail is a tooltip: it opens after a short hover or on focus, and
  // closes when the pointer or focus leaves the note.
  let timer: ReturnType<typeof setTimeout> | undefined;
  function show(delay = 0) {
    clearTimeout(timer);
    if (delay) timer = setTimeout(() => props.notes.showDetail(props.note), delay);
    else props.notes.showDetail(props.note);
  }
  function hide() {
    clearTimeout(timer);
    if (open()) props.notes.collapse();
  }
  function toggle() {
    if (open()) hide();
    else show();
  }
  onCleanup(() => {
    clearTimeout(timer);
    clearHover();
  });
  return (
    <div
      data-note
      class="relative select-none min-w-0 pr-4"
      style={{
        'max-width': props.width ? `${props.width}px` : undefined,
        'padding-left': `${props.indent || 0}px`,
      }}
      onMouseEnter={() => {
        editor.actions.hideHover();
        props.notes.setHovered(props.note);
        show(250);
      }}
      onMouseLeave={() => {
        clearHover();
        hide();
      }}
      onFocusOut={(event) => {
        if (!(
          event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)
        ))
          hide();
      }}
      onMouseDown={(event) => {
        if (!(event.target instanceof Element) || !event.target.closest('button'))
          event.preventDefault();
      }}
    >
      <div
        data-note-inline
        style={{
          height: props.rowHeight ? `${props.rowHeight}px` : undefined,
          'padding-top': `${GHOST_PADDING_TOP}px`,
          'padding-bottom': `${GHOST_PADDING_BOTTOM}px`,
        }}
      >
        <button
          type="button"
          class="btn h-full! max-w-full justify-start! gap-1.5 px-0! font-mono! text-xs! font-normal! text-special/75 hover:text-special"
          data-variant="ghost"
          data-control="note-summary"
          aria-label={props.note.summary}
          aria-expanded={open()}
          aria-controls={id}
          onClick={toggle}
          onFocus={() => show()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              toggle();
            }
          }}
        >
          <span
            class="icon-[ph--sparkle] shrink-0"
            role="img"
            title="AI explanation"
            aria-label="AI explanation"
          />
          <span class="truncate">{props.note.summary}</span>
          <Show when={props.note.stale}>
            <span class="shrink-0 text-10 text-warn">
              {props.note.stale === 'refs' ? 'may be outdated' : 'outdated'}
            </span>
          </Show>
        </button>
      </div>
      <Show when={open()}>
        <NotePanel id={id} note={props.note} review={props.review} />
      </Show>
    </div>
  );
}
export function GhostNotes(props: { line: number }): JSX.Element {
  const editor = useEditor();
  return (
    <For each={editor.notes.ghosts().get(props.line)}>
      {(note) => (
        <NoteGhost
          note={note}
          notes={editor.notes}
          rowHeight={editor.notes.rowHeight()}
          width={editor.geometry.width}
          indent={ghostIndent(
            editor.active()?.total || 1,
            editor.settings.preferences().lineNumbers,
            editor.geometry.charWidth,
            editor.buffer()?.lines[props.line - 1] || '',
          )}
        />
      )}
    </For>
  );
}
