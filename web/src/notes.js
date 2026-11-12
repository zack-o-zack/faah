// web/src/notes.js
import { $, S, doc_, api, apiPostJson, esc, debounce } from './state.js';
import { on, emit } from './bus.js';
import { onStream } from './stream.js';
import { layout, render, onPaint, lineTopY, lineHeightAt } from './renderer.js';
import { vp, sizer, rowsEl, editor, showToast } from './ui.js';
import { thrMdRefs, thrOpenLink, explainAgain } from './thread.js';
import { noteKey, indentCols, splitNotes, stackTops } from './notes-layout.js';

/* Explanation notes on the code. A symbol or line note is a ghost summary: a
   dimmed row above its line that the renderer lays out but the file does not
   contain. A block note sits in a column on the right, bracketing its lines.
   Notes come from /api/explain/notes for the open file, found again by their
   text, and reload whenever an explanation adds some. */

const MARGIN_W = 288;   // the notes column beside wrapped code
const MARKERS_W = 28;   // the same column collapsed to markers
const WIDE_CODE = 720;  // code narrower than this collapses the column

/** @typedef {import('./notes-layout.js').NoteView} NoteView */

/** @type {Map<string, NoteView[]>} */
const byPath = new Map();
let narrow = false;
let marginEl = null;
let cardEl = null;

function staleHtml(n) {
  if (!n.stale) return '';
  return '<span class="shrink-0 not-italic text-warn">' + (n.stale === 'refs' ? 'may be outdated' : 'outdated') + '</span>' +
    '<button type="button" data-note-act="refresh" class="btn not-italic" data-variant="ghost" data-size="xs">Refresh</button>';
}

/* Notes are written by the agent; they carry the mark the app uses for AI. */
const aiHtml = '<span class="icon-[lucide--sparkle] size-3 shrink-0 text-special" aria-hidden="true"></span>';

const dismissHtml = '<button type="button" data-note-act="dismiss" class="btn opacity-0 group-hover/note:opacity-100 focus-visible:opacity-100" data-variant="ghost" data-size="icon-xs" title="Dismiss note" aria-label="Dismiss note"><span class="icon-[lucide--x] size-3.5 shrink-0" aria-hidden="true"></span></button>';

function ghostRow(/** @type {NoteView[]} */ ns) {
  const first = ns[0];
  const summary = ns.map(n => n.summary).join(' · ');
  return {
    notes: ns,
    render: (/** @type {string} */ body) =>
      '<div data-note="' + esc(noteKey(first)) + '" class="group/note flex basis-full min-w-0 h-[var(--lh)] items-center gap-2 pr-10 select-none cursor-pointer text-special/70 hover:text-special"' +
      ' style="padding-left:calc(var(--gw,1)*1ch + 30px + ' + indentCols(body) + 'ch)" title="Open thread">' +
      '<span class="min-w-0 truncate text-xs italic">⟢ ' + esc(summary) + '</span>' + staleHtml(first) + dismissHtml + '</div>',
  };
}

function apply(path) {
  const list = S.notesHidden ? [] : (byPath.get(path) || []);
  const { ghosts, blocks } = splitNotes(list);
  const rows = new Map();
  for (const [line, ns] of ghosts) rows.set(line, ghostRow(ns));
  S.noteGhosts.set(path, rows);
  S.noteMargin.set(path, blocks.length ? (narrow ? MARKERS_W : MARGIN_W) : 0);
  S.notesGen = (S.notesGen || 0) + 1;
  if (doc_()?.path === path) { drawMargin(path, blocks); layout(); render(); }
}

const loading = new Map();
async function load(path) {
  if (!path) return;
  const ask = (loading.get(path) || 0) + 1;
  loading.set(path, ask);
  let notes = [];
  try { notes = (await api('/api/explain/notes', { path })).notes || []; } catch { return; }
  if (loading.get(path) !== ask) return;
  byPath.set(path, notes);
  apply(path);
}
const reloadActive = debounce(() => load(doc_()?.path), 250);

function find(key) {
  for (const list of byPath.values()) for (const n of list) if (noteKey(n) === key) return n;
  return null;
}

/* ---------- the notes column ---------- */

function drawMargin(path, blocks) {
  if (!marginEl) return;
  if (!blocks.length || S.notesHidden) { marginEl.innerHTML = ''; marginEl.hidden = true; return; }
  marginEl.hidden = false;
  marginEl.dataset.path = path;
  marginEl.innerHTML = blocks.map(n => {
    const key = esc(noteKey(n));
    const card = '<div class="flex flex-col gap-1 rounded-md border border-special/30 bg-popover/90 p-2 text-xs text-popover-foreground shadow-sm backdrop-blur-sm' +
      (narrow ? ' absolute right-full top-0 mr-2 w-64 hidden group-hover/note:flex group-focus-within/note:flex' : ' w-full') + '">' +
      '<div class="flex items-start gap-1"><button type="button" data-note-act="open" class="flex min-w-0 flex-1 items-baseline gap-1.5 text-left font-medium">' + aiHtml + '<span class="min-w-0">' + esc(n.summary) + '</span></button>' + dismissHtml + '</div>' +
      (n.detail ? '<div class="text-muted-foreground line-clamp-4 [&_p]:m-0">' + thrMdRefs(n.detail, n.links) + '</div>' : '') +
      (n.stale ? '<div class="flex items-center gap-1">' + staleHtml(n) + '</div>' : '') +
      '</div>';
    return '<div data-note="' + key + '" data-l1="' + n.l1 + '" data-l2="' + n.l2 + '" class="group/note pointer-events-auto absolute left-0 right-0">' +
      '<div data-note-part="bracket" class="absolute left-1 w-1.5 rounded-l-sm border-y border-l border-special/60"></div>' +
      '<div data-note-part="tie" class="absolute left-[9px] w-px bg-special/40" hidden></div>' +
      '<div data-note-part="card" class="absolute ' + (narrow ? 'left-0 right-0' : 'left-4 right-2') + '">' +
      (narrow ? '<button type="button" data-note-act="open" class="ml-3 mt-1 size-2.5 rounded-full bg-special" aria-label="' + esc(n.summary) + '"></button>' : '') +
      card + '</div></div>';
  }).join('');
}

/* Brackets follow the measured line positions, so the column is placed after
   each paint. Cards keep their order and never overlap. */
function placeMargin(d) {
  if (!marginEl || marginEl.hidden || marginEl.dataset.path !== d.path) return;
  const w = S.noteMargin.get(d.path) || MARGIN_W;
  // Without word wrap the column stays at the right edge of the view.
  marginEl.style.width = w + 'px';
  marginEl.style.left = (S.wrap ? sizer.clientWidth - w : vp.scrollLeft + vp.clientWidth - w - 12) + 'px';
  const items = [...marginEl.children].map(el => {
    const l1 = +el.dataset.l1, l2 = +el.dataset.l2;
    const top = lineTopY(l1, d);
    const card = /** @type {HTMLElement} */ (el.querySelector('[data-note-part=card]'));
    return { el, top, bottom: lineTopY(l2, d) + lineHeightAt(l2, d), card, height: narrow ? 14 : card.offsetHeight };
  });
  const tops = stackTops(items, 6);
  items.forEach((it, i) => {
    it.el.style.top = it.top + 'px';
    const bracket = /** @type {HTMLElement} */ (it.el.querySelector('[data-note-part=bracket]'));
    bracket.style.height = Math.max(4, it.bottom - it.top) + 'px';
    it.card.style.top = (tops[i] - it.top) + 'px';
    const tie = /** @type {HTMLElement} */ (it.el.querySelector('[data-note-part=tie]'));
    tie.hidden = tops[i] - it.top < 2;
    tie.style.height = (tops[i] - it.top) + 'px';
  });
}

function checkWidth(d) {
  const gutter = String(d.total || 1).length * (S.chW || 7.8) + 30;
  const isNarrow = vp.clientWidth - gutter < WIDE_CODE + MARGIN_W;
  if (isNarrow !== narrow) { narrow = isNarrow; if (byPath.has(d.path)) apply(d.path); }
}

/* ---------- hover: details and dimming ---------- */

let focusKey = '';
function focusNote(n) {
  const key = n ? noteKey(n) : '';
  if (key === focusKey) return;
  focusKey = key;
  applyFocus();
}

function applyFocus() {
  const n = focusKey && find(focusKey);
  rowsEl.classList.toggle('note-dim', !!n);
  for (const row of rowsEl.children) {
    const l = +(/** @type {HTMLElement} */ (row)).dataset.l;
    row.classList.toggle('note-hl', !!n && l >= n.l1 && l <= n.l2);
  }
  marginEl?.querySelectorAll('[data-note]').forEach(el => el.classList.toggle('z-10', !!n && el.getAttribute('data-note') === focusKey));
}

function noteAtLine(path, line) {
  for (const n of (S.notesHidden ? [] : byPath.get(path) || [])) if (line >= n.l1 && line <= n.l2) return n;
  return null;
}

let cardNote = null;
function showDetail(el, n) {
  if (!cardEl) return;
  cardNote = n;
  if (!n || !n.detail) { cardEl.hidden = true; return; }
  cardEl.innerHTML = '<div class="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-special">' + aiHtml + 'AI explanation</div>' + thrMdRefs(n.detail, n.links);
  cardEl.hidden = false;
  const r = el.getBoundingClientRect(), base = editor.getBoundingClientRect();
  const span = el.querySelector('span');
  const left = (span ? span.getBoundingClientRect().left : r.left) - base.left;
  cardEl.style.left = Math.max(8, Math.min(left, base.width - cardEl.offsetWidth - 8)) + 'px';
  // Above the ghost, so the code it explains stays in view; below only when the top is too close.
  const above = r.top - base.top - cardEl.offsetHeight - 4;
  cardEl.style.top = (above >= 8 ? above : r.bottom - base.top + 4) + 'px';
}

/* ---------- actions ---------- */

function plainLine(d, n) {
  const div = document.createElement('div');
  div.innerHTML = d.lines[n - 1] || '';
  return div.textContent || '';
}

/* Explains the note's code again, as it is now. */
function refresh(n) {
  const d = doc_();
  if (!d || d.path !== n.path) return;
  if (d.dirty) { showToast('error', 'Save the file to explain the current code'); return; }
  if (n.kind === 'symbol' && n.symbol) {
    const line = plainLine(d, n.l1);
    const at = line.search(new RegExp('(?<![\\p{L}\\p{N}_$])' + n.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}_$])', 'u'));
    if (at >= 0) { explainAgain({ path: n.path, l1: n.l1, l2: n.l1, c1: at, c2: at + n.symbol.length, text: n.symbol }); return; }
  }
  const text = [];
  for (let l = n.l1; l <= n.l2; l++) text.push(plainLine(d, l));
  explainAgain({ path: n.path, l1: n.l1, l2: n.l2, text: text.join('\n') });
}

async function dismiss(n) {
  try { await apiPostJson('/api/explain/notes/dismiss', { thread: n.thread, turn: n.turn, index: n.index }); }
  catch (e) { showToast('error', 'Could not dismiss the note: ' + e.message); return; }
  load(n.path);
}

function act(e) {
  const link = /** @type {HTMLElement|null} */ (e.target)?.closest('a.thr-link');
  if (link) { e.preventDefault(); thrOpenLink(link); return; }
  const el = /** @type {HTMLElement|null} */ (e.target)?.closest('[data-note]');
  if (!el) return;
  const n = find(el.getAttribute('data-note') || '');
  if (!n) return;
  const what = /** @type {HTMLElement|null} */ (e.target)?.closest('[data-note-act]')?.getAttribute('data-note-act');
  if (what === 'refresh') refresh(n);
  else if (what === 'dismiss') dismiss(n);
  // A ghost opens its thread anywhere on it; a card only from its summary.
  else if (what === 'open' || el.closest('.row')) emit('threads:open', n.thread);
}

/** Shows or hides every note, and remembers the choice. */
export function toggleNotes() {
  S.notesHidden = !S.notesHidden;
  try { localStorage.setItem('faah.notes', S.notesHidden ? 'off' : 'on'); } catch {}
  focusNote(null);
  for (const path of byPath.keys()) apply(path);
  showToast('success', S.notesHidden ? 'Explanation notes hidden' : 'Explanation notes shown');
}

export function initNotes() {
  S.noteGhosts = new Map();
  S.noteMargin = new Map();
  try { S.notesHidden = localStorage.getItem('faah.notes') === 'off'; } catch {}

  marginEl = document.createElement('div');
  marginEl.dataset.ui = 'note-margin';
  marginEl.className = 'pointer-events-none absolute top-0 z-[3]';
  marginEl.hidden = true;
  sizer.appendChild(marginEl);
  cardEl = $('#note-card');

  onPaint((d, fresh) => {
    if (fresh) { checkWidth(d); applyFocus(); }
    placeMargin(d);
  });

  // A ghost is not code: clicks on it must not move the caret or start a selection.
  for (const el of [rowsEl, marginEl]) {
    el.addEventListener('mousedown', e => {
      if (/** @type {HTMLElement|null} */ (e.target)?.closest('[data-note]')) { e.preventDefault(); e.stopPropagation(); }
    });
    el.addEventListener('click', act);
  }

  // The card waits while the pointer moves onto it, so its links can be clicked.
  let cardHide = 0;
  const keepCard = () => clearTimeout(cardHide);
  const dropCard = () => { clearTimeout(cardHide); cardHide = setTimeout(() => { if (cardEl) cardEl.hidden = true; }, 200); };
  cardEl?.addEventListener('mouseenter', () => { keepCard(); focusNote(cardNote); });
  cardEl?.addEventListener('mouseleave', () => { dropCard(); focusNote(null); });
  cardEl?.addEventListener('click', e => {
    const link = /** @type {HTMLElement|null} */ (e.target)?.closest('a.thr-link');
    if (!link) return;
    e.preventDefault();
    if (cardEl) cardEl.hidden = true;
    thrOpenLink(link);
  });

  // Hovering a note, or the code it explains, dims the rest of the file.
  let codeHover = 0;
  const over = e => {
    const t = /** @type {HTMLElement|null} */ (e.target);
    const noteEl = t?.closest('[data-note]');
    clearTimeout(codeHover);
    if (noteEl) {
      const n = find(noteEl.getAttribute('data-note') || '');
      focusNote(n);
      if (noteEl.closest('.row')) { keepCard(); showDetail(noteEl, n); }
      return;
    }
    dropCard();
    const row = t?.closest('.row');
    const d = doc_();
    const n = row && d ? noteAtLine(d.path, +(/** @type {HTMLElement} */ (row)).dataset.l) : null;
    if (!n) { focusNote(null); return; }
    codeHover = setTimeout(() => focusNote(n), 400);
  };
  const out = () => { clearTimeout(codeHover); focusNote(null); dropCard(); };
  for (const el of [rowsEl, marginEl]) {
    el.addEventListener('mouseover', over);
    el.addEventListener('mouseleave', out);
  }

  on('tab:activated', ({ doc } = {}) => { focusNote(null); if (doc?.path) load(doc.path); });
  onStream('threads:summary', sm => { if (sm.kind === 'explain') reloadActive(); });
  onStream('threads:deleted', () => reloadActive());
  load(doc_()?.path);
}
