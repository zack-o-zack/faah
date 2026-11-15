import type { Note } from '../threads/decode.ts';
import { api } from '../lib/api.ts';
import { decodeFileWindow } from '../editor/decode.ts';
import { decodeNotes } from './store.ts';
export async function locatePeekNotes(
  notes: Note[],
  thread: string,
  turn: number,
): Promise<Note[]> {
  if (!thread) return notes;
  const current = new Map<number, Note>();
  await Promise.all(
    [...new Set(notes.map((n) => n.path))].map(async (path) => {
      try {
        for (const note of decodeNotes(await api('api/explain/notes', { path })))
          if (note.thread === thread && note.turn === turn) current.set(note.index, note);
      } catch {
        /* Saved ranges remain available for deleted files. */
      }
    }),
  );
  return notes.map((note, index) => current.get(index) || note);
}
export async function loadPeekCode(path: string, lines: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  const runs: [number, number][] = [];
  for (const line of lines) {
    if (!line) continue;
    const run = runs.at(-1);
    if (run && line === run[1] + 1) run[1] = line;
    else runs.push([line, line]);
  }
  await Promise.all(
    runs.map(async ([first, last]) => {
      try {
        const file = decodeFileWindow(
          await api('api/file', { path, start: first - 1, count: last - first + 1 }),
        );
        for (const [index, html] of (file.lines || []).entries())
          result.set((file.start || 0) + index + 1, html);
      } catch {
        /* A missing file falls back to the saved source. */
      }
    }),
  );
  return result;
}
