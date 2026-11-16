import type { JSX } from 'solid-js';
import type { Note, ThreadTurn } from '../threads/decode.ts';
import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { peekGroups } from './layout.ts';
import { Markdown } from '../lib/Markdown.tsx';
import { loadPeekCode, locatePeekNotes } from './peeks.ts';
interface Props {
  turn: ThreadTurn;
  thread?: string;
  onOpen: (target: { path: string; line?: number; end?: number }) => void;
}
function Peek(
  props: Props & {
    notes: Note[];
    lines: number[];
    folded: boolean;
    fold: (closed: boolean) => void;
  },
): JSX.Element {
  const path = () => props.notes[0]?.path || '';
  const [code] = createResource(
    () => ({ path: path(), lines: props.lines }),
    ({ path, lines }) => loadPeekCode(path, lines),
  );
  const saved = (line: number) => {
    const note = props.notes.find((n) => line >= n.l1 && line <= n.l2);
    return note?.text.split('\n')[line - note.l1] || '';
  };
  return (
    <details
      data-ui="thr-peek"
      open={!props.folded}
      onToggle={(event) => props.fold(!event.currentTarget.open)}
      class="group/peek overflow-hidden rounded-xl border text-xs"
    >
      <summary class="flex cursor-pointer gap-2 px-2 py-1 font-mono text-muted-foreground">
        <span>
          {path()}:{props.lines[0]}
        </span>
        <span class="ml-auto">
          {props.notes.length} {props.notes.length === 1 ? 'note' : 'notes'}
        </span>
      </summary>
      <div class="overflow-x-auto py-1">
        <For each={props.lines}>
          {(line) => (
            <Show when={line} fallback={<div class="px-3 text-faint">…</div>}>
              <For each={props.notes.filter((n) => n.l1 === line)}>
                {(note) => (
                  <div class="px-3 py-1">
                    <div class="text-special">{note.summary}</div>
                    <Markdown
                      text={note.detail}
                      refs={props.turn.refs || {}}
                      onOpen={props.onOpen}
                    />
                  </div>
                )}
              </For>
              <button
                class="flex w-full gap-3 px-2 text-left font-mono leading-5 hover:bg-muted/60"
                classList={{
                  'border-l border-special': props.notes.some(
                    (n) => n.kind === 'block' && line >= n.l1 && line <= n.l2,
                  ),
                }}
                onClick={() => props.onOpen({ path: path(), line })}
              >
                <span class="select-none text-faint">{line}</span>
                <Show
                  when={code()?.get(line)}
                  fallback={<span class="whitespace-pre">{saved(line)}</span>}
                >
                  {(html) => (
                    // eslint-disable-next-line solid/no-innerhtml, no-restricted-syntax -- Server-highlighted source.
                    <span class="whitespace-pre" innerHTML={html()} />
                  )}
                </Show>
              </button>
            </Show>
          )}
        </For>
      </div>
    </details>
  );
}
export function ThreadPeeks(props: Props): JSX.Element {
  const [folded, setFolded] = createSignal<Record<string, boolean>>({});
  const [located] = createResource(
    () => ({ notes: props.turn.notes || [], thread: props.thread || '', turn: props.turn.id }),
    ({ notes, thread, turn }) => locatePeekNotes(notes, thread, turn),
  );
  const groups = createMemo(() => {
    const paths = new Set((located() || props.turn.notes || []).map((n) => n.path));
    return [...paths].flatMap((path) =>
      peekGroups((located() || props.turn.notes || []).filter((n) => n.path === path)),
    );
  });
  return (
    <div data-ui="thr-peeks" class="flex flex-col gap-2">
      <For each={groups()}>
        {(group) => (
          <Peek
            {...props}
            notes={group.notes}
            lines={group.lines}
            folded={!!folded()[`${group.notes[0]?.path}:${group.lines[0]}`]}
            fold={(closed) =>
              setFolded((previous) => ({
                ...previous,
                [`${group.notes[0]?.path}:${group.lines[0]}`]: closed,
              }))
            }
          />
        )}
      </For>
    </div>
  );
}
