import { layout, render, openFile, centerLine, pushHistory, loadOutline, drawOutline, doc_, api } from './app/legacy-bridge.js';
import { setPressed } from './controls.js';
// web/src/inspector.js
import { $, $$, esc, S } from './state.js';
import { emit } from './bus.js';

import { updateStatus, setStatusNote } from './status.js';

import { displayPath } from './search/logic.js';
import { cancelSearch } from './app/legacy-bridge.js';
import { groupHits, flashFind, canAskServer, lspCall, positionNow } from './lsp.js';

export function firstInspectorTab() {
  const first = Array.from($$('[data-control~=inspector-tab]')).find(b => !b.hidden);
  return first?.dataset.itab || 'refs';
}

export function showRightInspector(tab) {
  document.body.classList.add('threads-hidden');
  setPressed($('#btn-top-threads'), false);
  document.body.classList.remove('right-hidden');
  setPressed($('#btn-open-right'), true);
  setRightInspectorTab(tab || firstInspectorTab());
  layout();
  render();
}

export function hideRightInspector() {
  cancelSearch();
  document.body.classList.add('right-hidden');
  setPressed($('#btn-open-right'), false);
  layout();
  render();
}

export function setRightInspectorTab(tab) {
  if (tab !== 'search') cancelSearch();
  $$('[data-control~=inspector-tab]').forEach(b => setPressed(b, b.dataset.itab === tab));
  $('#pane-right-refs')?.classList.toggle('active', tab === 'refs');
  $('#pane-right-symbols')?.classList.toggle('active', tab === 'symbols');
  $('#pane-right-calls')?.classList.toggle('active', tab === 'calls');
  $('#pane-right-search')?.classList.toggle('active', tab === 'search');
  $('#pane-right-tips')?.classList.toggle('active', tab === 'tips');
  if (tab === 'tips') {
    emit('tips:shown');
    $('#tips-filter')?.focus();
  }
  if (tab === 'symbols') {
    loadOutline();
    $('#right-symbols-filter')?.focus();
  }
  if (tab === 'search') $('#q')?.focus();
}

export function renderRightResults(word, hits, server, isExact) {
  const targetEl = $('#right-ref-target');
  const badgeEl = $('#right-ref-badge');
  const listEl = $('#right-refs-list');
  if (!targetEl || !badgeEl || !listEl) return;

  targetEl.textContent = word;
  badgeEl.textContent = hits.length;

  if (!hits.length) {
    listEl.innerHTML = '<div data-ui="hint" class="empty text-muted-foreground">No references found for "<b>' + esc(word) + '</b>".</div>';
    return;
  }

  const grouped = groupHits(hits);
  const head = hits.length + ' reference' + (hits.length === 1 ? '' : 's') +
    (server ? ' · ' + esc(server) : ' · text search');
  let html = '<div data-ui="hint" class="empty text-muted-foreground">' + head + '</div>';

  for (const f of grouped) {
    html += '<div data-ui="rfile" class="flex items-center gap-2 p-2 cursor-pointer hover:bg-accent select-none [&.closed_[data-ui~=ar]]:-rotate-90" data-toggle="r-' + esc(f.path) + '" title="' + esc(f.path) + '">' +
      '<span data-ui="ar" class="icon-[lucide--chevron-down] size-3 shrink-0 text-muted-foreground" aria-hidden="true"></span>' +
      '<span data-ui="fp" class="truncate min-w-0">' + esc(displayPath(f.path)) + '</span>' +
      '<span data-ui="cnt" class="badge ml-auto">' + f.matches.length + '</span></div>' +
      '<div data-group="r-' + esc(f.path) + '">';
    for (const m of f.matches) {
      html += '<div data-ui="rline" class="flex min-w-0 items-center gap-2 p-2 cursor-pointer font-mono hover:bg-accent [&.sel]:bg-accent [&_mark]:bg-mark [&_mark]:text-inherit" data-p="' + esc(f.path) + '" data-n="' + m.line + '" title="Jump to ' + esc(f.path) + ':' + m.line + '">' +
        '<span data-ui="rn" class="w-12 shrink-0 text-right text-muted-foreground">' + m.line + '</span><span data-ui="rt" class="flex-1 truncate text-muted-foreground">' +
        esc(m.pre) + '<mark>' + esc(m.mid || word) + '</mark>' + esc(m.post) + '</span></div>';
    }
    html += '</div>';
  }
  listEl.innerHTML = html;
}

export async function inspectReferences(arg) {
  const d = doc_();
  const at = (arg && arg.word) ? arg : positionNow(typeof arg === 'string' ? arg : S.lastWord);
  if (!d || !at || !at.word) return;

  showRightInspector('refs');
  const targetEl = $('#right-ref-target');
  const badgeEl = $('#right-ref-badge');
  const listEl = $('#right-refs-list');
  if (targetEl) targetEl.textContent = at.word;
  if (badgeEl) badgeEl.textContent = '…';
  if (listEl) listEl.innerHTML = '<div data-ui="hint" class="empty text-muted-foreground">Finding references for "' + esc(at.word) + '"…</div>';

  if (canAskServer(at)) {
    setStatusNote('references to ' + at.word + '…', 8000);
    try {
      const j = await lspCall('refs', at, 30000);
      updateStatus();
      if (j && j.hits && j.hits.length) {
        setStatusNote('');
        renderRightResults(at.word, j.hits, j.server, true);
        return;
      }
    } catch {
      updateStatus();
    }
  }

  // Fallback: search workspace text for whole word
  setStatusNote('searching references to ' + at.word + '…', 8000);
  try {
    const j = await api('/api/search', { q: at.word, word: true, case: true });
    updateStatus();
    setStatusNote('');
    const hits = [];
    if (j.results) {
      for (const f of j.results) {
        for (const m of f.matches) {
          hits.push({ path: f.path, line: m.line, pre: m.pre, mid: m.mid, post: m.post });
        }
      }
    }
    renderRightResults(at.word, hits, '', false);
  } catch (err) {
    updateStatus();
    setStatusNote('');
    if (listEl) listEl.innerHTML = '<div data-ui="hint" class="empty text-muted-foreground">Search error: ' + esc(err.message) + '</div>';
  }
}

export function initInspector() {
  $$('[data-control~=inspector-tab]').forEach(btn => btn.addEventListener('click', () => {
    setRightInspectorTab(btn.dataset.itab);
  }));

  $('#btn-close-right')?.addEventListener('click', hideRightInspector);
  $('#btn-open-right')?.addEventListener('click', () => {
    if (document.body.classList.contains('right-hidden')) {
      showRightInspector();
    } else {
      hideRightInspector();
    }
  });

  /* Right inspector resizer */
  (() => {
    const rrz = $('#right-resizer');
    if (!rrz) return;
    let dragging = false;
    rrz.addEventListener('mousedown', e => { dragging = true; rrz.classList.add('drag'); e.preventDefault(); });
    addEventListener('mousemove', e => {
      if (!dragging) return;
      const w = Math.max(200, Math.min(700, window.innerWidth - e.clientX));
      $('#right-side').style.width = w + 'px';
    });
    addEventListener('mouseup', () => { if (dragging) { dragging = false; rrz.classList.remove('drag'); layout(); render(); } });
  })();

  /* Right-side symbols list navigation */
  $('#right-symbols-list')?.addEventListener('click', e => {
    const s = e.target.closest('[data-ui~=sym]');
    if (!s) return;
    $$('#right-symbols-list [data-ui~=sym].sel, #outline [data-ui~=sym].sel').forEach(x => x.classList.remove('sel'));
    s.classList.add('sel');
    const d = doc_(); if (!d) return;
    d.cur = +s.dataset.n;
    centerLine(d.cur);
    render();
    updateStatus();
    pushHistory(d.path, d.cur);
  });
  $('#right-symbols-filter')?.addEventListener('input', drawOutline);

  $('#right-refs-list')?.addEventListener('click', e => {
    const t = e.target.closest('[data-toggle]');
    if (t) {
      const listEl = $('#right-refs-list');
      const g = listEl.querySelector('[data-group="' + CSS.escape(t.dataset.toggle) + '"]');
      if (!g) return;
      const hidden = g.style.display === 'none';
      g.style.display = hidden ? '' : 'none';
      const ar = $('[data-ui~=ar]', t);
      if (ar) ar.classList.toggle('-rotate-90', !hidden);
      t.classList.toggle('closed', !hidden);
      return;
    }
    const r = e.target.closest('[data-ui~=rline]');
    if (r) {
      $$('#right-refs-list [data-ui~=rline].sel').forEach(x => x.classList.remove('sel'));
      r.classList.add('sel');
      openFile(r.dataset.p, { line: +r.dataset.n });
      const targetEl = $('#right-ref-target');
      if (targetEl && targetEl.textContent) flashFind(targetEl.textContent);
    }
  });
}
