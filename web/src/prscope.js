import { doc_ } from './app/legacy-bridge.js';
import { setPressed } from './controls.js';
// web/src/prscope.js
// PR review sidebar scope: "All PR changes" vs "Not pushed".
//
// A PR checkout already tells the two apart -- rows you touched carry a YOU
// tag, and a file's diff splits into "PR changes" and "Not pushed" -- but
// with dozens of PR files in the tree there was no way to see just your own.
// This bar sits above the changed-files tree in Git view and switches it
// between the whole PR and only what you have edited or committed since
// checkout (yourStatuses, from the git-status stream). The filtering itself is
// CSS on #tree (.scope-yours, .scope-pr); this module only owns the counts and the choice.
import { $, S } from './state.js';
import { on } from './bus.js';
import { treeEl, relabelTreeBadges, inGitMode, redrawTreeView } from './tree.js';
import { focusDiffScope, syncDiffView } from './diff.js';

let scope = 'all';           // 'all' | 'yours'
let allCount = 0, yourCount = 0;

const scopeBar = () => $('#scope-bar');

function apply() {
  const b = scopeBar();
  if (!b) return;
  const show = !!S.meta?.pr && inGitMode();
  // A toggle with one side empty is noise: it appears with the first edit
  // that is not pushed, and the tree falls back to the PR's files.
  b.hidden = !show || yourCount === 0;
  const yours = scope === 'yours' && show && yourCount > 0;
  treeEl.classList.toggle('scope-yours', yours);
  treeEl.classList.toggle('scope-pr', show && !yours);
  treeEl.classList.toggle('no-yours', yours && yourCount === 0);
  for (const btn of b.querySelectorAll('button[data-scope]')) {
    const on_ = btn.dataset.scope === (yours ? 'yours' : 'all');
    setPressed(btn, on_);
    btn.setAttribute('aria-pressed', on_ ? 'true' : 'false');
  }
  relabelTreeBadges();
  $('#scope-all-n').textContent = String(allCount);
  const yn = $('#scope-yours-n');
  yn.textContent = String(yourCount);
  yn.classList.toggle('has', yourCount > 0);
  redrawTreeView(); // folder chains compact by what the scope shows
}

/* Called with every git-status tick. */
export function updateScopeCounts(statuses = {}, yourStatuses = {}) {
  if (!S.meta?.pr) return;
  allCount = Object.keys(statuses).length;
  yourCount = Object.keys(yourStatuses).length;
  apply();
}

export function initPRScope() {
  const b = scopeBar();
  if (!b) return;
  b.addEventListener('click', e => {
    const btn = e.target.closest('button[data-scope]');
    if (!btn) return;
    scope = btn.dataset.scope;
    apply();
    // The file already open follows the scope too.
    const d = doc_();
    if (d?.diffMode) { focusDiffScope(d); syncDiffView(); }
  });
  on('sidebar:mode', apply);
}
