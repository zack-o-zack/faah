// web/src/notes-layout.js

/* Where explanation notes go on the code, kept apart from the DOM so it can be
   tested on its own. */

/** @typedef {{thread: string, turn: number, index: number, kind: string, path: string, l1: number, l2: number, symbol?: string, summary: string, detail?: string, stale?: string}} NoteView */

export const noteKey = (/** @type {NoteView} */ n) => n.thread + ':' + n.turn + ':' + n.index;

/** Leading indent of a highlighted line, in columns, so a ghost lines up with its code. */
export function indentCols(html) {
  const m = /^(?:<[^>]*>)*([ \t]*)/.exec(html || '');
  let cols = 0;
  for (const ch of m ? m[1] : '') cols += ch === '\t' ? 4 - (cols % 4) : 1;
  return cols;
}

/** Ghost notes by line, and block notes in line order.
    @param {NoteView[]} list */
export function splitNotes(list) {
  /** @type {Map<number, NoteView[]>} */
  const ghosts = new Map();
  const blocks = [];
  for (const n of list) {
    if (n.kind === 'block') blocks.push(n);
    else ghosts.set(n.l1, [...(ghosts.get(n.l1) || []), n]);
  }
  blocks.sort((a, b) => a.l1 - b.l1 || a.l2 - b.l2);
  return { ghosts, blocks };
}

/* Each card goes beside its block's first line, moved down below the one
   before it when they would overlap. */
/** @param {{top: number, height: number}[]} items @param {number} gap */
export function stackTops(items, gap) {
  const out = [];
  let bottom = -Infinity;
  for (const it of items) {
    const top = Math.max(it.top, bottom + gap);
    out.push(top);
    bottom = top + it.height;
  }
  return out;
}
