import type { NoteView } from './store.ts';
import type { ExplainTarget } from '../threads/decode.ts';
import { wordAtColumn } from '../editor/cursor.ts';
export function refreshTarget(note: NoteView, lineText: (index: number) => string): ExplainTarget {
  const line = lineText(note.l1 - 1);
  if (note.kind === 'symbol' && note.symbol) {
    let at = line.indexOf(note.symbol);
    while (at >= 0) {
      if (wordAtColumn(line, at)?.word === note.symbol)
        return {
          path: note.path,
          l1: note.l1,
          l2: note.l1,
          c1: at,
          c2: at + note.symbol.length,
          text: note.symbol,
        };
      at = line.indexOf(note.symbol, at + 1);
    }
  }
  return {
    path: note.path,
    l1: note.l1,
    l2: note.l2,
    text: Array.from({ length: note.l2 - note.l1 + 1 }, (_, index) =>
      lineText(note.l1 - 1 + index),
    ).join('\n'),
  };
}
