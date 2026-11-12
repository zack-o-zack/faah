import { openFile, api } from './app/legacy-bridge.js';
// web/src/unpushed.js
// The Unpushed section in the sidebar: the local commits ahead of the tracking
// branch (@{u}..HEAD), each expandable into the files it touched, each file
// opening that commit's own diff.
//
// Before this, faah could only show the working tree against HEAD, so the
// moment you committed -- even locally -- the change dropped out of view. This
// section covers the gap between `git commit` and `git push`.
//
// It sits behind the same "changed files only" toggle as the git file tree,
// and it is why that toggle stays available on a clean working tree: commits
// you haven't pushed are exactly the case where the tree has nothing left to
// show. No upstream configured means no section at all -- there is no guessed
// fallback branch, since a list measured against the wrong ref is worse than
// no list.
import { $, S, esc } from './state.js';
import { on } from './bus.js';

import { copyToClipboard } from './ui.js';
import { treeEl, updateSidebarToggleState, inGitMode } from './tree.js';
import { makeCardKeeper, pointerPos } from './cardkeep.js';
import { commitFileRows, COMMIT_FILES_PAGE } from './commitfiles.js';

const upPanel = () => $('#unpushed');
const upBody = () => $('#unpushed-body');
const upCard = () => $('#commitcard');

const UP_CARD_DELAY = 300; // rest time on a commit row before its card opens

let upList = [];                  // UnpushedCommit[], newest first
let upUpstream = '';              // "origin/master", the ref the list is measured against
let upOpenSha = '';               // the one expanded commit, '' for none
let upShown = COMMIT_FILES_PAGE;  // file rows built for the open commit
let upActiveFile = '';            // "<sha>\0<path>" of the file row showing in the editor
const upFiles = new Map();        // sha -> CommitFile[] (a commit's file list never changes)
const upDetails = new Map();      // sha -> CommitDetail
let upSig = '';                   // last (ahead, head SHA) seen, to skip pointless refetches
let upCardTimer = 0, upCardSeq = 0, upCardSha = '';
let upKeeper = null;

/* Visible only in "changed files only" mode, and only with something to list. */
export function syncUnpushedVisibility() {
  const p = upPanel();
  if (!p) return;
  p.hidden = !(inGitMode() && upList.length > 0);
  if (p.hidden) hideCommitCard();
}

/* Refetches the list. `payload` is a git-status tick, whose ahead count and
   head SHA together say whether anything actually moved -- the section is
   rebuilt only when they did, so the SSE stream doesn't shell out to git log
   on every heartbeat. Call with nothing to force a refetch. */
export async function refreshUnpushed(payload) {
  if (!S.meta?.git) return;
  if (payload) {
    const next = (payload.ahead ?? 0) + ':' + (payload.recentCommits?.[0]?.hash || '');
    if (next === upSig) return;
    upSig = next;
  } else {
    upSig = '';
  }

  let j;
  try {
    j = await api('/api/unpushed');
  } catch {
    return; // no upstream, no git, no section -- never a toast
  }

  const next = j.commits || [];
  upUpstream = j.upstream || '';
  // A commit that vanished (amend, rebase, push) takes its cached rows with it.
  const live = new Set(next.map(c => c.hash));
  for (const sha of [...upFiles.keys()]) if (!live.has(sha)) upFiles.delete(sha);
  for (const sha of [...upDetails.keys()]) if (!live.has(sha)) upDetails.delete(sha);
  if (!live.has(upOpenSha)) upOpenSha = '';

  upList = next;
  S.unpushedCount = upList.length;
  updateSidebarToggleState();
  drawUnpushed();
  syncUnpushedVisibility();
}

function drawUnpushed() {
  const el = upBody();
  if (!el) return;

  const title = $('.unpushed-title');
  if (title) title.textContent = S.meta?.pr ? 'Your commits' : 'Unpushed';
  const count = $('#unpushed-count');
  if (count) count.textContent = upList.length ? String(upList.length) : '';
  const up = $('#unpushed-upstream');
  if (up) {
    up.textContent = upUpstream;
    up.title = upUpstream ? 'Commits on this branch that ' + upUpstream + ' does not have yet' : '';
  }

  el.innerHTML = upList.map(c => {
    const open = c.hash === upOpenSha;
    return '<div class="up-commit' + (open ? ' open' : '') + '" data-sha="' + esc(c.hash) + '">' +
      '<div role="button" tabindex="0" title="' + esc(c.subject || '') + '" class="up-row flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1 text-xs hover:bg-accent focus-visible:outline-ring focus-visible:outline">' +
        '<span class="up-ar size-2 shrink-0 border-r border-t border-muted-foreground rotate-45 [.up-commit.open_&]:rotate-[135deg]"></span>' +
        '<span class="up-subject min-w-0 flex-1 truncate">' + esc(c.subject || '(no message)') + '</span>' +
        '<span class="up-sha shrink-0 font-mono text-xs text-muted-foreground">' + esc(c.short || '') + '</span>' +
      '</div>' +
      '<div class="up-files hidden [.up-commit.open_&]:block">' + (open ? openCommitRows(c.hash) : '') + '</div>' +
    '</div>';
  }).join('');
}

function openCommitRows(sha) {
  const all = upFiles.get(sha);
  if (!all) return '<div class="up-note truncate px-3 py-1 text-xs text-muted-foreground">Loading files…</div>';
  if (!all.length) return '<div class="up-note truncate px-3 py-1 text-xs text-muted-foreground">No files in this commit.</div>';
  const active = upActiveFile.startsWith(sha + '\0') ? upActiveFile.slice(sha.length + 1) : '';
  return commitFileRows(all, 0, upShown, active);
}

async function toggleUnpushedCommit(sha) {
  upOpenSha = upOpenSha === sha ? '' : sha;
  upShown = COMMIT_FILES_PAGE;
  drawUnpushed();
  if (!upOpenSha || upFiles.has(sha)) return;
  try {
    const j = await api('/api/commitfiles', { sha });
    upFiles.set(sha, j.files || []);
  } catch {
    upFiles.set(sha, []);
  }
  if (upOpenSha === sha) drawUnpushed();
}

/* ---------- commit hover card ---------- */

function commitKeeper() {
  const el = upCard();
  if (el && !upKeeper) upKeeper = makeCardKeeper(el, { hide: hideCommitCard });
  return upKeeper;
}

export function hideCommitCard() {
  clearTimeout(upCardTimer);
  upCardTimer = 0;
  upCardSeq++;
  upCardSha = '';
  upKeeper?.close();
  const el = upCard();
  if (el && !el.hidden) { el.hidden = true; el.replaceChildren(); }
}

async function showCommitCard(sha, x, y) {
  const el = upCard();
  if (!el) return;
  const keeper = commitKeeper();
  const seq = ++upCardSeq;

  let d = upDetails.get(sha);
  if (!d) {
    try { d = await api('/api/commitdetail', { sha }); } catch { return; }
    upDetails.set(sha, d);
  }
  if (seq !== upCardSeq) return;

  // Anchor where the pointer is now: the fetch above may have taken a while,
  // and a card anchored behind the pointer closes the moment it moves again.
  const live = pointerPos() || { x, y };
  upCardSha = sha;
  el.innerHTML = commitCardMarkup(d);
  el.hidden = false;
  placeCommitCard(el, live.x, live.y);
  keeper.open(live);

  el.querySelector('[data-control~=cc-copy]')?.addEventListener('click', e => {
    e.stopPropagation();
    copyToClipboard(d.hash, 'Copied ' + d.short, e.currentTarget);
  });
}

function commitCardMarkup(d) {
  const stat = [];
  if (d.files) stat.push('<span data-ui="cc-files" class="text-muted-foreground">' + d.files + (d.files === 1 ? ' file' : ' files') + '</span>');
  if (d.insertions) stat.push('<span data-ui="cc-add" class="text-gi">+' + d.insertions + '</span>');
  if (d.deletions) stat.push('<span data-ui="cc-del" class="text-gd">&minus;' + d.deletions + '</span>');

  const name = esc(d.author || 'unknown');
  /* Best effort: a users.noreply.github.com address carries the login outright,
     any other address only supports "this repo's commits by this author". A
     non-GitHub remote gets no link and the name stays plain text. */
  const who = d.authorUrl
    ? '<a data-ui="cc-who" class="font-semibold" href="' + esc(d.authorUrl) + '" target="_blank" rel="noopener" title="' +
      esc(d.email || '') + ' — open on GitHub">' + name + '</a>'
    : '<span data-ui="cc-who" class="font-semibold" title="' + esc(d.email || '') + '">' + name + '</span>';

  return '<div data-ui="cc-head" class="flex items-center gap-2 p-3">' +
      '<span data-ui="cc-sha" class="font-mono text-primary-text" title="' + esc(d.hash) + '">' + esc(d.short) + '</span>' +
      '<span class="flex-1 min-w-0"></span>' +
      '<button type="button" title="Copy the full SHA" class="btn" data-control="cc-copy" data-variant="outline" data-size="xs">Copy SHA</button>' +
    '</div>' +
    '<div data-ui="cc-meta" class="flex items-center flex-wrap gap-2 p-3 text-muted-foreground">' + who +
      '<span data-ui="cc-dot" class="text-muted-foreground">·</span>' +
      '<span class="cc-date" title="' + esc(d.dateIso || '') + '">' + esc(d.date || '') + '</span>' +
    '</div>' +
    '<div data-ui="cc-msg" class="overflow-x-hidden overflow-y-auto whitespace-pre-wrap p-3 font-mono">' + esc(d.message || d.subject || '') + '</div>' +
    (stat.length ? '<div data-ui="cc-stat" class="flex items-center gap-2 p-3 font-mono">' + stat.join('') + '</div>' : '');
}

/* Just clear of the sidebar rather than under the pointer: the card is wider
   than the sidebar, and anchoring it to the pointer would bury the very list
   it describes. Vertically it follows the pointer, clamped to the window. */
function placeCommitCard(el, x, y) {
  const r = el.getBoundingClientRect();
  const side = $('#side')?.getBoundingClientRect();
  let left = (side ? side.right : x) + 8;
  if (left + r.width > innerWidth - 8) left = Math.max(8, innerWidth - r.width - 8);
  let top = y - 12;
  if (top + r.height > innerHeight - 8) top = innerHeight - r.height - 8;
  el.style.left = left + 'px';
  el.style.top = Math.max(8, top) + 'px';
}

/* ---------- wiring ---------- */

export function initUnpushed() {
  const el = upBody();
  if (!el) return;

  $('#unpushed-collapse')?.addEventListener('click', () => {
    upPanel()?.classList.toggle('collapsed');
    hideCommitCard();
  });

  // Same drag-the-top-edge resizer as the git panel below it.
  const rz = $('#unpushed-resizer');
  if (rz) {
    let dragging = false;
    rz.addEventListener('mousedown', e => {
      dragging = true;
      rz.classList.add('drag');
      upPanel()?.classList.remove('collapsed');
      e.preventDefault();
    });
    addEventListener('mousemove', e => {
      if (!dragging) return;
      const p = upPanel();
      if (!p) return;
      p.style.height = Math.max(60, Math.min(innerHeight * 0.7, p.getBoundingClientRect().bottom - e.clientY)) + 'px';
    });
    addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      rz.classList.remove('drag');
    });
  }

  el.addEventListener('click', e => {
    if (e.target.closest('[data-control~=up-more]')) { upShown += COMMIT_FILES_PAGE; drawUnpushed(); return; }
    const file = e.target.closest('[data-commit-file]');
    if (file) {
      const sha = file.closest('.up-commit')?.dataset.sha;
      if (!sha) return;
      upActiveFile = sha + '\0' + file.dataset.path;
      for (const r of el.querySelectorAll('[data-commit-file].sel')) r.classList.remove('sel');
      file.classList.add('sel');
      openFile(file.dataset.path, { ref: sha, view: 'diff' });
      return;
    }
    const row = e.target.closest('.up-row');
    if (row) {
      hideCommitCard();
      toggleUnpushedCommit(row.closest('.up-commit').dataset.sha);
    }
  });

  el.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest('[data-control~=up-more]')) {
      e.preventDefault();
      const first = upShown;
      upShown += COMMIT_FILES_PAGE;
      drawUnpushed();
      el.querySelectorAll('.up-commit.open [data-commit-file]')[first]?.focus();
      return;
    }
    const file = e.target.closest('[data-commit-file]');
    if (file) { e.preventDefault(); file.click(); return; }
    const row = e.target.closest('.up-row');
    if (!row) return;
    e.preventDefault();
    toggleUnpushedCommit(row.closest('.up-commit').dataset.sha);
  });

  /* The card follows the commit row under the pointer; once it is open its
     keeper watches the pointer the rest of the way in, across the gap between
     the sidebar and the card (see cardkeep.js). */
  el.addEventListener('mousemove', e => {
    const row = e.target.closest('.up-row');
    if (!row) { clearTimeout(upCardTimer); upCardTimer = 0; return; }
    const sha = row.closest('.up-commit')?.dataset.sha;
    if (!sha || sha === upCardSha) return;
    clearTimeout(upCardTimer);
    const { clientX, clientY } = e;
    upCardTimer = setTimeout(() => showCommitCard(sha, clientX, clientY), UP_CARD_DELAY);
  });
  el.addEventListener('mouseleave', () => { clearTimeout(upCardTimer); upCardTimer = 0; });
  el.addEventListener('scroll', hideCommitCard, { passive: true });
  addEventListener('keydown', e => { if (e.key === 'Escape') hideCommitCard(); });

  // tree.js owns the Explorer/Git toggle but knows nothing about this section.
  on('sidebar:mode', syncUnpushedVisibility);
}
