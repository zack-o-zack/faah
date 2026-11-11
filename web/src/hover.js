import { wordAtColumn } from './hover-position.js';
// web/src/hover.js
import { $, esc, S, doc_, api, isMac, MOD, withKeys } from './state.js';
import { vp, editor, copyToClipboard, showToast } from './ui.js';
import { updateLinkDecoration, rowFor } from './renderer.js';
import { setLspState } from './status.js';
import { wordAtPoint } from './cursor.js';
import { gotoDefinition, findReferences } from './lsp.js';
import { showCalls } from './calls.js';
import { diffview } from './diff.js';
import { makeCardKeeper, pointerPos } from './cardkeep.js';

export const hovercard = $('#hovercard');
export const HOVER_DELAY = 380;   // rest time before the card opens
// How far the pointer may have drifted while the hover request was in flight
// before the answer is stale enough to drop rather than show somewhere else.
const HOVER_DRIFT = 220;

let hoverTimer = 0, hoverSeq = 0, moveRAF = 0, pendingMove = null, pointerAt = null;

/* The card's lifetime belongs to the keeper, which watches the pointer across
   the whole document -- not to a mouseleave on whatever the card happens to
   overlap. See cardkeep.js for why that distinction is the whole fix. */
const hoverKeeper = makeCardKeeper(hovercard, { hide: hideHover });

const sameWord = (a, b) => !!a && !!b && a.line === b.line && a.col === b.col && a.word === b.word;

/* Hit-testing a point costs a few milliseconds: it forces layout and walks the
   line's nodes. Far too much to spend on every animation frame, so it runs only
   when the modifier is actually held, or once the pointer has come to rest and
   the card is about to open. Everything on the hot path below is arithmetic. */
export function onMove({ x, y, mod }) {
  if (mod) {
    const at = doc_() ? wordAtPoint(x, y) : null;
    if (!sameWord(at, S.link)) {
      S.link = at;
      vp.classList.toggle('linking', !!at);
      if (diffview) diffview.classList.toggle('linking', !!at);
      updateLinkDecoration();
    }
    clearTimeout(hoverTimer);
    hideHover();
    return;
  }

  if (S.link) {
    S.link = null;
    vp.classList.remove('linking');
    if (diffview) diffview.classList.remove('linking');
    updateLinkDecoration();
  }

  // An open card is the keeper's business; moving under it must not re-arm a
  // second request for the word the card is already describing.
  if (!hovercard.hidden) { clearTimeout(hoverTimer); return; }

  if (S.settings && (S.settings['lsp.hover.enabled'] === false || S.settings['lsp.enabled'] === false)) return;
  if (S.lsp.state !== 'ready' && S.lsp.state !== 'indexing') return;
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => hoverAt(x, y), HOVER_DELAY);
}

export function hoverAt(x, y) {
  const at = doc_() ? wordAtPoint(x, y) : null;
  if (at && at.word) showHover(at, x, y);
}

export async function showHover(at, x, y, { focus = false } = {}) {
  const d = doc_();
  if (!d || at.path !== d.path) return;
  const seq = ++hoverSeq;
  let j;
  try { j = await api('/api/lsp/hover', { path: d.path, line: at.line, col: at.col, wait: 4000 }); }
  catch { return; }
  if (seq !== hoverSeq || doc_() !== d) return;   // the pointer moved on
  setLspState(j);
  const diags = (d.diagnostics || []).filter(dg => dg.line === at.line);
  if ((!j || j.empty || (!j.signature && !j.doc)) && !diags.length) {
    if (focus) showToast('info', 'No documentation for this symbol');
    return;
  }
  j = j || {};

  /* The request can take seconds. Open the card where the pointer is *now*,
     not where it rested when the request went out -- an anchor that far behind
     puts the card outside its own corridor and closes it on the next move. If
     the pointer has gone somewhere else entirely, drop the answer instead. */
  const live = pointerPos();
  if (!focus && live && Math.hypot(live.x - x, live.y - y) > HOVER_DRIFT) return;
  const ax = !focus && live ? live.x : x, ay = !focus && live ? live.y : y;

  S.hover = at;
  S.hoverAnchor = { x: ax, y: ay };
  const refPath = d.path + ':' + at.line;
  // A problem on this line leads the card: the line only shows its first sentence.
  const act = (id, label, title) => '<button id="' + id + '" title="' + title + '" class="btn" data-variant="ghost" data-size="xs">' + label + '</button>';
  hovercard.innerHTML =
    diags.map(dg => {
      const err = (dg.severity || 1) === 1;
      return '<div data-ui="diag" class="flex gap-2 border-b px-3 py-2 text-xs">' +
        '<span class="' + (err ? 'icon-[lucide--circle-x] text-destructive' : 'icon-[lucide--triangle-alert] text-warn') + ' mt-px size-3.5 shrink-0" aria-hidden="true"></span>' +
        '<span class="min-w-0 whitespace-pre-wrap wrap-anywhere">' + esc(dg.message || '') +
        (dg.source ? ' <span class="text-muted-foreground">' + esc(dg.source) + (dg.code ? ' ' + esc(String(dg.code)) : '') + '</span>' : '') + '</span></div>';
    }).join('') +
    (j.signature ? '<div data-ui="sig" class="whitespace-pre-wrap wrap-anywhere px-3 py-2 font-mono text-xs">' + j.signature + '</div>' : '') +
    (j.doc ? '<div data-ui="doc" class="max-h-60 overflow-auto whitespace-pre-wrap wrap-anywhere px-3 pb-2 text-sm text-muted-foreground">' + esc(j.doc) + '</div>' : '') +
    '<div data-ui="actions" class="flex flex-wrap items-center gap-0.5 border-t px-1.5 py-1">' +
      act('hc-def-src', 'Definition', withKeys('Jump to definition ({Mod+Click})')) +
      act('hc-def-diff', 'In diff', withKeys('Jump to definition in the diff ({Mod+Alt+Click})')) +
      act('hc-find-refs', 'Usages', withKeys('Find all usages ({Shift+F12})')) +
      act('hc-calls', 'Calls', withKeys('Trace callers and callees ({Alt+Shift+H})')) +
      act('hc-copy-ref', 'Copy ref', 'Copy file and line reference') +
      act('hc-copy-ai', 'Copy with context', 'Copy the line with its file path and line number') +
      '<span class="ml-auto px-1.5 text-xs text-muted-foreground">' + esc(j.server || 'lsp') + '</span>' +
    '</div>';

  const btnDefSrc = hovercard.querySelector('#hc-def-src');
  const btnDefDiff = hovercard.querySelector('#hc-def-diff');
  const btnRef = hovercard.querySelector('#hc-copy-ref');
  const btnAi = hovercard.querySelector('#hc-copy-ai');
  const btnRefs = hovercard.querySelector('#hc-find-refs');
  const btnCalls = hovercard.querySelector('#hc-calls');

  if (btnDefSrc) btnDefSrc.onclick = (e) => {
    e.stopPropagation();
    hideHover();
    gotoDefinition(at, { view: 'source' });
  };
  if (btnDefDiff) btnDefDiff.onclick = (e) => {
    e.stopPropagation();
    hideHover();
    gotoDefinition(at, { view: 'diff' });
  };
  if (btnRef) btnRef.onclick = (e) => {
    e.stopPropagation();
    copyToClipboard(refPath, 'Copied', btnRef);
  };
  if (btnAi) btnAi.onclick = (e) => {
    e.stopPropagation();
    const lineText = (d.lines && d.lines[at.line - 1]) || at.word || '';
    const ext = d.path.split('.').pop() || '';
    const lineStr = 'line ' + at.line;
    const text = '@' + d.path + ' ' + lineStr + '\n```' + ext + '\n' + lineText + '\n```';
    copyToClipboard(text, 'Copied', btnAi);
  };
  if (btnRefs) btnRefs.onclick = (e) => {
    e.stopPropagation();
    hideHover();
    findReferences(at.word);
  };
  if (btnCalls) btnCalls.onclick = (e) => {
    e.stopPropagation();
    hideHover();
    S.at = at;
    showCalls(at);
  };

  hovercard.hidden = false;
  placeHover(ax, ay);
  hoverKeeper.open({ x: ax, y: ay });
  if (focus) hovercard.focus({ preventScroll: true });
}

/** Read symbol documentation without requiring a pointer hover. */
export function showHoverAtCaret() {
  const d = doc_();
  if (!d || d.isImage || d.isEditing) return;
  const row = d.diffMode ? diffview.querySelector(`[data-l="${d.cur}"]`) : rowFor(d.cur);
  const code = row?.querySelector(d.diffMode ? '.diff-code' : '.c');
  const token = code && wordAtColumn(code.textContent || '', d.col || 0);
  if (!token) { showToast('info', 'Place the caret on a symbol to read its documentation'); return; }
  const r = code.getBoundingClientRect();
  showHover({ ...token, line: d.cur, path: d.path }, r.left + 8, r.top, { focus: true });
}

/* Anchor below the pointer, flipping above or inward when that would overflow
   the editor. */
export function placeHover(x, y) {
  const host = editor.getBoundingClientRect();
  const card = hovercard.getBoundingClientRect();
  let left = x - host.left + 6;
  let top = y - host.top + 20;
  if (left + card.width > host.width - 12) left = Math.max(8, host.width - card.width - 12);
  if (top + card.height > host.height - 8) {
    const above = y - host.top - card.height - 12;
    top = above > 8 ? above : Math.max(8, host.height - card.height - 8);
  }
  hovercard.style.left = left + 'px';
  hovercard.style.top = top + 'px';
}

export function hideHover() {
  hoverKeeper.close();
  hoverSeq++;
  S.hover = null;
  S.hoverAnchor = null;
  if (!hovercard.hidden) { hovercard.hidden = true; hovercard.innerHTML = ''; }
}

export function clearLink() {
  clearTimeout(hoverTimer);
  hideHover();
  if (S.link) {
    S.link = null;
    vp.classList.remove('linking');
    if (diffview) diffview.classList.remove('linking');
    updateLinkDecoration();
  }
}

export function initHover() {
  const attachPointer = (el) => {
    if (!el) return;
    el.addEventListener('mousemove', e => {
      pointerAt = { x: e.clientX, y: e.clientY };
      pendingMove = { x: e.clientX, y: e.clientY, mod: e[MOD] };
      if (moveRAF) return;
      moveRAF = requestAnimationFrame(() => {
        moveRAF = 0;
        const m = pendingMove;
        pendingMove = null;
        if (m) onMove(m);
      });
    });
    /* Leaving the code only cancels a card that hasn't opened yet. One that
       has is the keeper's, which is still watching the pointer out here. */
    el.addEventListener('mouseleave', () => {
      pointerAt = null;
      clearTimeout(hoverTimer);
      if (hovercard.hidden) clearLink();
    });
    el.addEventListener('scroll', () => { clearTimeout(hoverTimer); hideHover(); }, { passive: true });
    el.addEventListener('mousedown', (e) => {
      if (e.target.closest('#hovercard')) return;
      hideHover();
    });
    el.addEventListener('dblclick', e => {
      hoverKeeper.cancel();
      hoverAt(e.clientX, e.clientY);
    });
  };

  attachPointer(vp);
  attachPointer(diffview);

  /* The modifier can be pressed or released without the pointer moving, and the
     underline has to follow. */
  const modKey = isMac ? 'Meta' : 'Control';   // the key MOD tests; Ctrl+click on a Mac is a right click
  addEventListener('keydown', e => {
    if (e.key === modKey && pointerAt) onMove({ ...pointerAt, mod: true });
  });
  addEventListener('keyup', e => {
    if (e.key === modKey) clearLink();
  });
}
