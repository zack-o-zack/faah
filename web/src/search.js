import { setPressed } from './controls.js';
// web/src/search.js
import { $, $$, esc, api, debounce } from './state.js';
import { openFile } from './tabs.js';
import { flashFind } from './lsp.js';

export const resultsEl = $('#results');
export let lastResults = null;

let searchAbort = null;

export function cancelSearch() {
  if (searchAbort) {
    searchAbort.abort();
    searchAbort = null;
  }
}

// The search panel is optional markup; without it every entry point is a no-op.
export const runSearch = debounce(async () => {
  const qEl = $('#q');
  if (!qEl || !resultsEl) return;
  const q = qEl.value;
  if (!q.trim()) {
    cancelSearch();
    resultsEl.innerHTML = '';
    return;
  }
  cancelSearch();
  const controller = new AbortController();
  searchAbort = controller;
  resultsEl.innerHTML = '<div data-ui="hint" class="empty text-muted-foreground">searching…</div>';
  const params = {
    q, glob: $('#glob')?.value || '',
    case: $('#o-case')?.getAttribute('aria-pressed') === 'true' ? 1 : '',
    word: $('#o-word')?.getAttribute('aria-pressed') === 'true' ? 1 : '',
    re: $('#o-re')?.getAttribute('aria-pressed') === 'true' ? 1 : '',
  };
  try {
    const j = await api('/api/search', params, { signal: controller.signal });
    if (searchAbort === controller) {
      searchAbort = null;
      renderResults(j);
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
    if (searchAbort === controller) {
      searchAbort = null;
      resultsEl.innerHTML = '<div data-ui="hint" class="empty text-muted-foreground">' + esc(e.message) + '</div>';
    }
  }
}, 160);

export function renderResults(j) {
  lastResults = j;
  if (!resultsEl) return;
  if (!j.results || !j.results.length) {
    resultsEl.innerHTML = '<div data-ui="hint" class="empty text-muted-foreground">No results.</div>';
    return;
  }
  const head = j.header || (j.total.toLocaleString() + ' result' + (j.total === 1 ? '' : 's') +
    ' in ' + j.files.toLocaleString() + ' file' + (j.files === 1 ? '' : 's') + (j.truncated ? ' (truncated)' : ''));
  let html = '<div data-ui="hint" class="empty text-muted-foreground">' + esc(head) + '</div>';
  for (const f of j.results) {
    html += '<div data-ui="rfile" class="flex items-center gap-2 p-2 cursor-pointer hover:bg-accent select-none [&.closed_[data-ui~=ar]]:-rotate-90" data-toggle="' + esc(f.path) + '" title="' + esc(f.path) + '">' +
      '<span data-ui="ar" class="shrink-0 text-muted-foreground">&#9660;</span>' +
      (f.ext ? '<span data-ui="ext" class="badge">ext</span>' : '') +
      '<span data-ui="fp" class="truncate min-w-0">' + esc(displayPath(f.path)) + '</span>' +
      '<span data-ui="cnt" class="badge ml-auto">' + f.matches.length + '</span></div>' +
      '<div data-group="' + esc(f.path) + '">';
    for (const m of f.matches) {
      html += '<div data-ui="rline" class="flex min-w-0 items-center gap-2 p-2 cursor-pointer font-mono hover:bg-accent [&.sel]:bg-accent [&_mark]:bg-mark [&_mark]:text-inherit" data-p="' + esc(f.path) + '" data-n="' + m.line + '" title="Jump to ' + esc(f.path) + ':' + m.line + '">' +
        '<span data-ui="rn" class="w-12 shrink-0 text-right text-muted-foreground">' + m.line + '</span><span data-ui="rt" class="flex-1 truncate text-muted-foreground">' +
        esc(m.pre) + '<mark>' + esc(m.mid) + '</mark>' + esc(m.post) + '</span></div>';
    }
    html += '</div>';
  }
  resultsEl.innerHTML = html;
}

/* External results carry an absolute path, which is far too long for the
   panel. Show enough of the tail to identify the file. */
export function displayPath(p) {
  if (p.length <= 48) return p;
  const parts = p.split('/');
  return '…/' + parts.slice(-3).join('/');
}

export function initSearch() {
  if (!resultsEl) return;
  resultsEl.addEventListener('click', e => {
    const t = e.target.closest('[data-toggle]');
    if (t) {
      const g = resultsEl.querySelector('[data-group="' + CSS.escape(t.dataset.toggle) + '"]');
      if (!g) return;
      const hidden = g.style.display === 'none';
      g.style.display = hidden ? '' : 'none';
      const ar = $('[data-ui~=ar]', t);
      if (ar) ar.innerHTML = hidden ? '&#9660;' : '&#9654;';
      t.classList.toggle('closed', !hidden);
      return;
    }
    const r = e.target.closest('[data-ui~=rline]');
    if (r) {
      $$('[data-ui~=rline].sel', resultsEl).forEach(x => x.classList.remove('sel'));
      r.classList.add('sel');
      openFile(r.dataset.p, { line: +r.dataset.n });
      const q = $('#q')?.value;
      if (q) flashFind(q);
    }
  });

  $('#q')?.addEventListener('input', runSearch);
  $('#glob')?.addEventListener('input', runSearch);
  $$('[data-control~=opt]').forEach(b => b.addEventListener('click', () => { setPressed(b, b.getAttribute('aria-pressed') !== 'true'); runSearch(); }));
  $('#q')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); const f = $('[data-ui~=rline]', resultsEl); if (f) f.click(); }
  });
}
