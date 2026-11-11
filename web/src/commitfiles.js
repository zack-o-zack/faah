// web/src/commitfiles.js
// A commit's changed files as sidebar rows, shared by Recent Commits
// (gitpanel.js) and the Unpushed section (unpushed.js), styled by the [data-commit-file]
// rules. Rows are built COMMIT_FILES_PAGE at a time behind a "Show N more" row,
// so a commit of thousands of files costs no more DOM than one of a hundred
// until someone asks for more.
import { esc, api } from './state.js';

export const COMMIT_FILES_PAGE = 100;

const fileLists = new Map(); // SHA -> CommitFile[] once loaded, or the pending Promise

// A commit's files never change, so each list is fetched once and shared by the
// sidebar rows and the diff strip.
export function loadCommitFiles(sha) {
  const have = fileLists.get(sha);
  if (have) return Promise.resolve(have);
  const req = api('/api/commitfiles', { sha }).then(
    j => { const files = j.files || []; fileLists.set(sha, files); return files; },
    e => { fileLists.delete(sha); throw e; });
  fileLists.set(sha, req);
  return req;
}

export function cachedCommitFiles(sha) {
  const have = fileLists.get(sha);
  return Array.isArray(have) ? have : null;
}

/* git's name-status letter -> the badge classes the file tree already uses, so
   a commit's file list reads the same as the working-tree one. */
export const COMMIT_STATUS = {
  M: ['git-M', 'modified'], A: ['git-A', 'added'], D: ['git-D', 'deleted'],
  R: ['git-R', 'renamed'], C: ['git-A', 'copied'], T: ['git-M', 'type changed'],
  U: ['git-untracked', 'unmerged'],
};

// Rows files[from, to), then a "Show more" row if any are left. active is the
// path to mark selected.
export function commitFileRows(files, from, to, active = '') {
  to = Math.min(files.length, to);
  let html = '';
  for (let i = from; i < to; i++) html += commitFileRow(files[i], files[i].path === active);
  const left = files.length - to;
  if (left > 0) {
    html += '<div class="btn w-full" data-control="up-more" data-variant="ghost" data-size="xs" role="button" tabindex="0">Show ' + Math.min(left, COMMIT_FILES_PAGE) +
      ' more · ' + left.toLocaleString() + ' remaining</div>';
  }
  return html;
}

function commitFileRow(f, sel) {
  const g = COMMIT_STATUS[f.status] || ['git-M', f.status];
  const name = f.path.split('/').pop();
  const dir = f.path.slice(0, f.path.length - name.length).replace(/\/$/, '');
  const from = f.from ? ' (was ' + f.from + ')' : '';
  // Fixed columns keep the counts and status letters lined up down the list.
  const stat = f.binary ? '<span class="col-span-2 text-muted-foreground">bin</span>'
    : '<span class="text-gi">' + (f.add ? '+' + f.add : '') + '</span>' +
      '<span class="text-gd">' + (f.del ? '&minus;' + f.del : '') + '</span>';
  return '<div data-commit-file class="flex min-w-0 items-center gap-2 rounded px-2 py-1 text-xs cursor-pointer hover:bg-accent [&.sel]:bg-accent' + (sel ? ' sel' : '') + '" data-path="' + esc(f.path) + '" tabindex="0" role="button" ' +
    'title="' + esc(f.path + from) + ' — ' + esc(g[1]) + ' in this commit">' +
    '<span class="min-w-0 shrink truncate">' + esc(name) + '</span>' +
    '<span class="min-w-0 flex-1 truncate text-muted-foreground">' + esc(dir) + '</span>' +
    '<span class="grid shrink-0 grid-cols-[5ch_5ch] gap-1 text-right font-mono tabular-nums">' + stat + '</span>' +
    '<span class="gs w-3 shrink-0 text-center font-mono [&.git-M]:text-primary-text [&.git-R]:text-primary-text [&.git-A]:text-gi [&.git-untracked]:text-gi [&.git-D]:text-gd ' + g[0] + '" title="' + esc(g[1]) + '">' + esc(f.status) + '</span>' +
  '</div>';
}
