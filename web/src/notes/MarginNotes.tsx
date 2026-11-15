import type { JSX } from 'solid-js';
import { createMemo, createSignal, For, Show, onCleanup } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { NoteCard } from './NoteCard.tsx';
import { Popover } from '../lib/Popover.tsx';
import { noteKey } from './store.ts';
import { stackTops } from './layout.ts';
export function MarginNotes(props: { first: number; last: number }): JSX.Element {
  const editor = useEditor();
  const [heights, setHeights] = createSignal<Record<string, number>>({});
  const visible = createMemo(() =>
    editor.notes.split().blocks.filter((n) => n.l2 > props.first && n.l1 <= props.last),
  );
  const tops = createMemo(() =>
    stackTops(
      visible().map((note) => ({
        top: Math.max(editor.geometry.top, editor.offsets()[note.l1 - 1] || 0),
        height: editor.notes.margin() === 24 ? 20 : heights()[noteKey(note)] || 130,
      })),
    ),
  );
  return (
    <div
      data-note
      class="absolute top-0 h-full select-none bg-background"
      style={{
        width: `${editor.notes.margin()}px`,
        left: `${editor.geometry.left + editor.geometry.width - editor.notes.margin()}px`,
      }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <For each={visible()}>
        {(note, index) => {
          const [open, setOpen] = createSignal(false);
          let timer: ReturnType<typeof setTimeout> | undefined;
          onCleanup(() => clearTimeout(timer));
          const enter = () => {
            clearTimeout(timer);
            setOpen(true);
            editor.notes.setHovered(note);
          };
          const leave = () => {
            timer = setTimeout(() => {
              setOpen(false);
              const current = editor.notes.hovered();
              if (current && noteKey(current) === noteKey(note)) editor.notes.setHovered(null);
            }, 140);
          };
          const start = () => editor.offsets()[note.l1 - 1] || 0;
          const end = () => editor.offsets()[note.l2] || start() + 20;
          return (
            <>
              <div
                class="pointer-events-none absolute left-0 w-2 border-y border-l border-special/60"
                style={{ top: `${start()}px`, height: `${end() - start()}px` }}
              />
              <div
                class="pointer-events-none absolute left-1 w-px bg-special/50"
                style={{
                  top: `${start()}px`,
                  height: `${Math.max(0, (tops()[index()] || 0) - start())}px`,
                }}
              />
              <div
                class="absolute left-2 right-2"
                style={{ top: `${tops()[index()] || 0}px` }}
                onMouseEnter={enter}
                onMouseLeave={leave}
              >
                <Show
                  when={editor.notes.margin() > 24}
                  fallback={
                    <Popover
                      open={open()}
                      onOpenChange={setOpen}
                      label={<span class="size-2 rounded-full bg-special" />}
                      accessibleLabel={note.summary}
                      triggerClass="btn px-0!"
                      panelClass="fixed z-[70] w-80 max-w-[95vw] p-0! border-0! bg-transparent! shadow-none!"
                    >
                      <div onMouseEnter={enter} onMouseLeave={leave}>
                        <NoteCard note={note} />
                      </div>
                    </Popover>
                  }
                >
                  <div
                    ref={(element) => {
                      const observer = new ResizeObserver(() => {
                        const height = element.getBoundingClientRect().height;
                        setHeights((previous) =>
                          Math.abs((previous[noteKey(note)] || 0) - height) < 1
                            ? previous
                            : { ...previous, [noteKey(note)]: height },
                        );
                      });
                      observer.observe(element);
                      onCleanup(() => observer.disconnect());
                    }}
                  >
                    <NoteCard note={note} />
                  </div>
                </Show>
              </div>
            </>
          );
        }}
      </For>
    </div>
  );
}
