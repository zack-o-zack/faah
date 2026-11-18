import { createMemo, createResource, createSignal, onCleanup } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { OrbModel } from '../viewers/orb-model.ts';
import type { Request } from '../lib/api.ts';
import type { Note, Citation } from '../threads/decode.ts';
import { decodeNote, decodeCitations } from '../threads/decode.ts';
import { record, list, text, number } from '../lib/decode.ts';
import { GHOST_PADDING_TOP, GHOST_PADDING_BOTTOM } from './layout.ts';
import { api } from '../lib/api.ts';
export interface NoteView extends Note {
  thread: string;
  turn: number;
  index: number;
  stale: string;
  links: Record<string, Citation>;
}
export const noteKey = (note: NoteView): string => `${note.thread}:${note.turn}:${note.index}`;
export function decodeNotes(value: unknown): NoteView[] {
  return list(record(value).notes).map((item) => {
    const n = record(item);
    return {
      ...decodeNote(item),
      thread: text(n.thread),
      turn: number(n.turn),
      index: number(n.index),
      stale: text(n.stale),
      links: decodeCitations(n.links || {}),
    };
  });
}
export function createNotesStore(
  source: Accessor<{ path: string; version: string } | false>,
  lineHeight: Accessor<number>,
  bubble: Accessor<OrbModel | null>,
  options: { request?: Request; all?: boolean } = {},
) {
  const [hovered, setHovered] = createSignal<NoteView | null>(null);
  const [expanded, setExpanded] = createSignal('');
  const [error, setError] = createSignal('');
  const [notes, { refetch }] = createResource(
    () => {
      const model = bubble();
      const target = source();
      return model?.id && target ? { ...target, thread: model.id, turn: model.turn } : false;
    },
    async (target) => {
      try {
        const result = decodeNotes(
          await (options.request || api)('api/explain/notes', {
            ...(options.all ? {} : { path: target.path }),
            thread: target.thread,
            turn: target.turn,
          }),
        );
        setError('');
        return result;
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Could not load notes');
        return [];
      }
    },
  );
  const visible = createMemo(() =>
    bubble()?.id && source()
      ? (notes.latest || []).filter(
          (n) =>
            (options.all || n.path === (source() || { path: '' }).path) &&
            n.thread === bubble()?.id &&
            n.turn === bubble()?.turn,
        )
      : [],
  );
  const ghosts = createMemo(() => {
    const rows = new Map<number, NoteView[]>();
    for (const note of visible()) rows.set(note.l1, [...(rows.get(note.l1) || []), note]);
    return rows;
  });
  const extraRows = createMemo(() =>
    Object.fromEntries([...ghosts()].map(([line, notes]) => [line - 1, notes.length])),
  );
  const expandedNote = createMemo(
    () => visible().find((note) => noteKey(note) === expanded()) || null,
  );
  const activeHover = createMemo(() => {
    const note = hovered();
    return note ? visible().find((item) => noteKey(item) === noteKey(note)) || null : null;
  });
  // References are checked in the background by the server. Revisit only while notes are shown.
  const timer = setInterval(() => {
    if (bubble()?.id && source() && visible().some((n) => n.kind === 'symbol')) void refetch();
  }, 10000);
  onCleanup(() => clearInterval(timer));
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(reloadTimer));
  return {
    scheduleReload() {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        if (bubble()?.id && source()) void refetch();
      }, 250);
    },
    hovered: activeHover,
    setHovered,
    notes: visible,
    ghosts,
    rowHeight: () => lineHeight() + GHOST_PADDING_TOP + GHOST_PADDING_BOTTOM,
    heightBefore(line: number) {
      return (
        (extraRows()[line - 1] || 0) * (lineHeight() + GHOST_PADDING_TOP + GHOST_PADDING_BOTTOM)
      );
    },
    expanded: expandedNote,
    showDetail(note: NoteView) {
      setExpanded(noteKey(note));
    },
    collapse() {
      setExpanded('');
    },
    covers(line: number) {
      return visible().some((note) => line >= note.l1 && line <= note.l2);
    },
    highlighted(line: number) {
      const note = activeHover();
      return !!note && line >= note.l1 && line <= note.l2;
    },
    /** Lines outside the hovered note fade so its range stands out. */
    dimmed(line: number) {
      const note = activeHover();
      return !!note && (line < note.l1 || line > note.l2);
    },
    extraRows,
    error,
    refetch,
    hoverLine(line: number) {
      setHovered(visible().find((n) => line >= n.l1 && line <= n.l2) || null);
    },
  };
}

/** A separate notes instance shares fetching and interaction behavior across review files. */
export function createTurnNotes(
  bubble: Accessor<OrbModel | null>,
  lineHeight: Accessor<number>,
  options: { active: Accessor<boolean>; request?: Request },
) {
  const notes = createNotesStore(
    () =>
      options.active() ? { path: '', version: `${bubble()?.phase}:${bubble()?.notes}` } : false,
    lineHeight,
    bubble,
    { ...options, all: true },
  );
  const byPath = createMemo(() => {
    const paths = new Map<string, Map<number, NoteView[]>>();
    for (const note of notes.notes()) {
      const rows = paths.get(note.path) || new Map<number, NoteView[]>();
      rows.set(note.l1, [...(rows.get(note.l1) || []), note]);
      paths.set(note.path, rows);
    }
    return paths;
  });
  return {
    ...notes,
    byPath,
    highlighted(path: string, line: number) {
      return notes.hovered()?.path === path && notes.highlighted(line);
    },
    dimmed(path: string, line: number) {
      return notes.hovered()?.path === path && notes.dimmed(line);
    },
  };
}

export type NotesAPI = Pick<
  ReturnType<typeof createNotesStore>,
  'expanded' | 'showDetail' | 'collapse' | 'hovered' | 'setHovered'
>;
