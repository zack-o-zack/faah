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

/* The thread shows notes as peeks of the code they explain. Notes close
   together share a peek, a long block shows its first lines and its last, and
   0 marks lines left out. */
/** @param {NoteView[]} list notes on one file @param {number} long @param {number} join */
export function peekGroups(list, long = 8, join = 2) {
  /** @type {{notes: NoteView[], shown: Set<number>, last: number}[]} */
  const groups = [];
  for (const n of [...list].sort((a, b) => a.l1 - b.l1 || b.l2 - a.l2)) {
    const shown = [];
    for (let l = n.l1; l <= n.l2 && (n.l2 - n.l1 < long || l <= n.l1 + long - 3); l++) shown.push(l);
    shown.push(n.l2);
    const g = groups[groups.length - 1];
    if (g && n.l1 <= g.last + join + 1) {
      g.notes.push(n);
      for (const l of shown) g.shown.add(l);
      g.last = Math.max(g.last, n.l2);
    } else groups.push({ notes: [n], shown: new Set(shown), last: n.l2 });
  }
  return groups.map(g => {
    const sorted = [...g.shown].sort((a, b) => a - b);
    /** @type {number[]} */
    const lines = [];
    for (const l of sorted) {
      const prev = lines[lines.length - 1];
      if (prev && l - prev - 1 > join) lines.push(0);
      else if (prev) for (let k = prev + 1; k < l; k++) lines.push(k);
      lines.push(l);
    }
    return { notes: g.notes, lines };
  });
}
