import type { JSX } from 'solid-js';
import { createSignal, For, onCleanup } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { Popover } from '../lib/Popover.tsx';
import { NoteCard } from './NoteCard.tsx';
import { indentCols } from './layout.ts';
import type { NoteView } from './store.ts';
function Ghost(props: { note: NoteView; indent: number }): JSX.Element {
  const editor = useEditor();
  const [open, setOpen] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  const enter = () => {
    clearTimeout(timer);
    setOpen(true);
    editor.notes.setHovered(props.note);
  };
  const leave = () => {
    timer = setTimeout(() => {
      setOpen(false);
      editor.notes.setHovered(null);
    }, 140);
  };
  return (
    <div
      data-note
      class="select-none h-[var(--lh)] whitespace-nowrap text-special"
      style={{
        'padding-left': `calc(${String(editor.active()?.total || 1).length}ch + 30px + ${props.indent}ch)`,
      }}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      <Popover
        open={open()}
        onOpenChange={setOpen}
        triggerClass="btn h-[var(--lh)]! max-w-full truncate px-0! font-mono! text-special!"
        accessibleLabel={props.note.summary}
        label={
          <span onClick={() => void editor.actions.openThread(props.note.thread)}>
            {props.note.summary}
            {props.note.stale
              ? ' · ' + (props.note.stale === 'refs' ? 'may be outdated' : 'outdated')
              : ''}
          </span>
        }
        placement={(trigger, panel) => ({
          left: Math.max(8, Math.min(innerWidth - panel.width - 8, trigger.left)) + 'px',
          top: Math.max(8, trigger.top - panel.height - 4) + 'px',
        })}
        panelClass="fixed z-[70] w-80 max-w-[95vw] p-0! border-0! bg-transparent! shadow-none!"
      >
        <div onMouseEnter={enter} onMouseLeave={leave}>
          <NoteCard note={props.note} />
        </div>
      </Popover>
    </div>
  );
}
export function GhostNotes(props: { line: number }): JSX.Element {
  const editor = useEditor();
  return (
    <For each={editor.notes.split().ghosts.get(props.line)}>
      {(note) => (
        <Ghost note={note} indent={indentCols(editor.buffer()?.lines[props.line - 1] || '')} />
      )}
    </For>
  );
}
