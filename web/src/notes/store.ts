import { createMemo, createResource, createSignal, onCleanup } from 'solid-js';
import type { Accessor } from 'solid-js';
import type { Request } from '../lib/api.ts';
import type { Note, Citation } from '../threads/decode.ts';
import { decodeNote, decodeCitations } from '../threads/decode.ts';
import { record, list, text, number } from '../lib/decode.ts';
import { api, apiPostJson } from '../lib/api.ts';
import { marginWidth } from './layout.ts';
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
  width: Accessor<number>,
  options: { request?: Request; post?: Request } = {},
) {
  const [shown, setShown] = createSignal(localStorage.getItem('faah.notes') !== 'off');
  const [hovered, setHovered] = createSignal<NoteView | null>(null);
  const [error, setError] = createSignal('');
  const [notes, { refetch, mutate }] = createResource(
    () => shown() && source(),
    async (target) => {
      try {
        const result = decodeNotes(
          await (options.request || api)('api/explain/notes', { path: target.path }),
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
    shown() && source()
      ? (notes.latest || []).filter((n) => n.path === (source() || { path: '' }).path)
      : [],
  );
  const split = createMemo(() => {
    const ghosts = new Map<number, NoteView[]>();
    const blocks: NoteView[] = [];
    for (const n of visible()) {
      if (n.kind === 'block') blocks.push(n);
      else ghosts.set(n.l1, [...(ghosts.get(n.l1) || []), n]);
    }
    return { ghosts, blocks };
  });
  const extraRows = createMemo(() =>
    Object.fromEntries([...split().ghosts].map(([line, notes]) => [line - 1, notes.length])),
  );
  // References are checked in the background by the server. Revisit only while notes are shown.
  const timer = setInterval(() => {
    if (shown() && source() && visible().some((n) => n.kind === 'symbol')) void refetch();
  }, 10000);
  onCleanup(() => clearInterval(timer));
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(reloadTimer));
  return {
    scheduleReload() {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        if (shown() && source()) void refetch();
      }, 250);
    },
    shown,
    hovered,
    setHovered,
    notes: visible,
    split,
    extraRows,
    error,
    margin: () => marginWidth(width(), split().blocks.length > 0),
    toggle() {
      const next = !shown();
      setShown(next);
      setHovered(null);
      localStorage.setItem('faah.notes', next ? 'on' : 'off');
    },
    refetch,
    async dismiss(note: NoteView) {
      await (options.post || apiPostJson)('api/explain/notes/dismiss', {
        thread: note.thread,
        turn: note.turn,
        index: note.index,
      });
      mutate((notes) => notes?.filter((n) => noteKey(n) !== noteKey(note)));
      setHovered(null);
    },
    dimmed(line: number) {
      const note = hovered();
      return !!note && (line < note.l1 || line > note.l2);
    },
    hoverLine(line: number) {
      setHovered(visible().find((n) => line >= n.l1 && line <= n.l2) || null);
    },
  };
}
