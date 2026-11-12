// web/src/notes-peek.js
import { esc, api } from './state.js';
import { indentCols, peekGroups } from './notes-layout.js';

/* An explanation's notes in its thread, drawn as peeks of the code they
   explain: each summary sits above its line as it does in the editor, with the
   detail under it, and a block's lines carry its bracket. Peeks use the notes'
   current lines and are built once per turn. */

/** @typedef {import('./notes-layout.js').NoteView} NoteView */

/** @type {Map<string, string>} */
const built = new Map();
const building = new Set();
/** Peeks the reader folded, kept across redraws of the thread. */
const folded = new Set();
document.addEventListener('toggle', e => {
  const el = /** @type {HTMLDetailsElement} */ (e.target);
  const id = el.dataset?.peek;
  if (id) el.open ? folded.delete(id) : folded.add(id);
}, true);

/** Forgets built peeks, so the next look at a thread reads the code again. */
export function clearPeeks() { built.clear(); }

/** The peeks for a finished turn, or the fallback while they are built.
    @param {string} thread @param {any} turn @param {string} fallback @param {(md: string) => string} md */
export function peeksHtml(thread, turn, fallback, md) {
  const key = thread + ':' + turn.id;
  const h = built.get(key);
  if (h) return withFolds(h);
  if (!building.has(key)) {
    building.add(key);
    build(thread, turn, md)
      .then(html => {
        built.set(key, html);
        const el = document.querySelector('[data-peeks="' + key + '"]');
        if (el) el.outerHTML = withFolds(html);
      })
      .catch(() => {})
      .finally(() => building.delete(key));
  }
  return '<div data-peeks="' + esc(key) + '">' + fallback + '</div>';
}

/** @param {string} h */
const withFolds = h => h.replace(/data-peek="([^"]+)" open/g, (m, id) => folded.has(id) ? 'data-peek="' + id + '"' : m);

/** @param {string} thread @param {any} turn @param {(md: string) => string} md */
async function build(thread, turn, md) {
  /** @type {NoteView[]} */
  const saved = (turn.notes || []).map((/** @type {any} */ n, /** @type {number} */ index) => ({ ...n, thread, turn: turn.id, index }));
  const paths = [...new Set(saved.map(n => n.path))];
  let out = '', n = 0;
  for (const path of paths) {
    // Where each note is now. A note the editor no longer shows keeps its saved lines.
    const now = new Map();
    try {
      const j = await api('/api/explain/notes', { path });
      for (const v of j.notes || []) if (v.thread === thread && v.turn === turn.id) now.set(v.index, v);
    } catch { /* the file is gone: saved lines */ }
    const list = saved.filter(n => n.path === path).map(n => now.get(n.index) || n);
    for (const g of peekGroups(list)) out += await peekHtml(thread + ':' + turn.id + ':' + n++, path, g, md);
  }
  return '<div data-ui="thr-peeks" class="flex flex-col gap-2">' + out + '</div>';
}

/** @param {string} id @param {string} path @param {{notes: NoteView[], lines: number[]}} g @param {(md: string) => string} md */
async function peekHtml(id, path, g, md) {
  const real = g.lines.filter(Boolean);
  const first = real[0], last = real[real.length - 1];
  /** @type {Map<number, string>} */
  const code = new Map();
  for (const run of runs(real)) {
    const j = await api('/api/file', { path, start: run[0] - 1, count: run[1] - run[0] + 1 });
    (j.lines || []).forEach((/** @type {string} */ h, /** @type {number} */ i) => code.set(j.start + i + 1, h));
  }
  const gw = String(last).length;
  const blocks = g.notes.filter(n => n.kind === 'block');
  const at = (/** @type {number} */ l) => g.notes.filter(n => n.l1 === l).sort((a, b) => (a.kind === 'block' ? 0 : 1) - (b.kind === 'block' ? 0 : 1));
  let rows = '';
  for (const l of g.lines) {
    if (!l) { rows += '<div class="select-none py-0.5 text-faint" style="padding-left:calc(' + gw + 'ch + 0.75rem)">⋯</div>'; continue; }
    const h = code.get(l) ?? '';
    for (const n of at(l)) rows += noteHtml(n, gw, Math.min(indentCols(h), 12), md);
    const bracket = blocks.some(b => l >= b.l1 && l <= b.l2) ? 'border-special/60' : 'border-transparent';
    rows += '<a href="#" class="thr-link flex border-l-2 no-underline hover:bg-muted/60 ' + bracket + '" data-path="' + esc(path) + '" data-line="' + l + '">' +
      '<span class="shrink-0 select-none pr-2 pl-1 text-right text-faint" style="width:calc(' + gw + 'ch + 0.75rem)">' + l + '</span>' +
      '<span class="whitespace-pre pr-2 text-foreground [&_i]:not-italic">' + h + '</span></a>';
  }
  // The header folds the peek; its path still opens the file.
  const count = g.notes.length + (g.notes.length === 1 ? ' note' : ' notes');
  return '<details data-ui="thr-peek" data-peek="' + id + '" open class="group/peek min-w-0 overflow-hidden rounded-md border text-xs">' +
    '<summary class="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1 font-mono text-muted-foreground hover:text-foreground group-open/peek:border-b [&::-webkit-details-marker]:hidden">' +
    '<span class="icon-[lucide--chevron-right] size-3 shrink-0 transition-transform group-open/peek:rotate-90 motion-reduce:transition-none" aria-hidden="true"></span>' +
    '<a href="#" class="thr-link min-w-0 truncate no-underline hover:underline" data-path="' + esc(path) + '" data-line="' + first + '"' + (last > first ? ' data-end="' + last + '"' : '') + '>' +
    esc(path) + ':' + first + (last > first ? '-' + last : '') + '</a>' +
    '<span class="ml-auto shrink-0 font-sans text-faint">' + count + '</span></summary>' +
    '<div class="md-code overflow-x-auto py-1 font-mono leading-5 [tab-size:var(--tab-size,4)]">' + rows + '</div></details>';
}

/** @param {NoteView} n @param {number} gw @param {number} indent @param {(md: string) => string} md */
function noteHtml(n, gw, indent, md) {
  const stale = n.stale ? ' <span class="not-italic text-warn">' + (n.stale === 'refs' ? 'may be outdated' : 'outdated') + '</span>' : '';
  return '<div class="border-l-2 border-transparent py-0.5 pr-2" style="padding-left:calc(' + (gw + indent) + 'ch + 0.75rem)">' +
    '<div class="italic text-special">⟢ ' + esc(n.summary) + stale + '</div>' +
    (n.detail ? '<div class="thr-body mt-0.5 font-sans text-muted-foreground [&_p]:m-0">' + md(n.detail) + '</div>' : '') + '</div>';
}

/** Consecutive lines as [first, last] runs. @param {number[]} lines */
function runs(lines) {
  const out = [];
  for (const l of lines) {
    const r = out[out.length - 1];
    if (r && l === r[1] + 1) r[1] = l;
    else out.push([l, l]);
  }
  return out;
}
