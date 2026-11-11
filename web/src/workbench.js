import { setMenuHidden } from './overlays.js';
// web/src/workbench.js
// The workbench page (web/workbench.html), what a bare `faah` opens. Bundled on
// its own into web/workbench.js by scripts/build-web.js. It shares the app's
// theme and status-bar metrics modules and nothing else, so it stays small.
// The server side is workbench.go and workbench_clone.go.
import { $, esc } from './state.js';
import { listThemes, currentTheme, setTheme, getStoredTheme, chooseThemePreference } from './theme.js';
import { showMetrics, initMetricsMenu } from './metricsview.js';

const req = async (path, body) => {
  const opts = body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  };
  const r = await fetch(new URL(path, document.baseURI), opts);
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
};

const ICON_DIR = '<span class="icon-[lucide--folder] size-3.5 shrink-0" aria-hidden="true"></span>';
const ICON_PR = '<span class="icon-[lucide--git-pull-request] size-3.5 shrink-0" aria-hidden="true"></span>';

let state = { items: [], cwd: '', home: '', sep: '/' };
let browsePath = '';
let lastSig = '';
let pendingPR = ''; // the PR URL waiting for its clone to be chosen

/* ---------- theme ---------- */

// The server rendered the configured theme; a theme picked in this browser wins
// the same way it does in the app (theme-preference.js).
const configuredTheme = currentTheme();
setTheme(chooseThemePreference(getStoredTheme(), configuredTheme), false);

const themeMenu = $('#wb-theme-menu');
let themeSel = 0;
let themeBefore = null;

function placeThemeMenu() {
  const r = $('#btn-theme').getBoundingClientRect();
  themeMenu.style.bottom = (innerHeight - r.top + 6) + 'px';
  themeMenu.style.right = Math.max(8, innerWidth - r.right) + 'px';
}

function renderThemeMenu() {
  themeMenu.innerHTML = listThemes().map((t, i) => `<button type="button" role="menuitemradio" data-id="${esc(t.id)}" aria-checked="${i === themeSel}" class="aria-checked:bg-accent">
    <span>${esc(t.name)}</span><span class="text-muted-foreground">${esc(t.id === themeBefore ? 'current' : t.scheme)}</span></button>`).join('');
  themeMenu.children[themeSel]?.scrollIntoView({ block: 'nearest' });
}

// Like the app's Select Theme palette: arrows preview, Enter or click keeps,
// Esc restores the theme from before.
function openThemeMenu() {
  themeBefore = currentTheme();
  themeSel = Math.max(0, listThemes().findIndex(t => t.id === themeBefore));
  renderThemeMenu();
  setMenuHidden(themeMenu, false);
  placeThemeMenu();
}

function closeThemeMenu(keep) {
  if (themeMenu.hidden) return;
  setMenuHidden(themeMenu, true);
  if (keep) setTheme(currentTheme());
  else if (themeBefore) setTheme(themeBefore, false);
}

function previewTheme(i) {
  const all = listThemes();
  themeSel = (i + all.length) % all.length;
  setTheme(all[themeSel].id, false);
  renderThemeMenu();
}

$('#btn-theme').addEventListener('click', e => {
  e.stopPropagation();
  if (themeMenu.hidden) openThemeMenu();
  else closeThemeMenu(true);
});
themeMenu.addEventListener('click', e => {
  const li = e.target.closest('[data-id]');
  if (!li) return;
  setTheme(li.dataset.id, false);
  closeThemeMenu(true);
});
themeMenu.addEventListener('mousemove', e => {
  const li = e.target.closest('[data-id]');
  if (!li) return;
  const i = [...themeMenu.children].indexOf(li);
  if (i !== themeSel) previewTheme(i);
});
addEventListener('click', e => {
  if (!e.target.closest('#wb-theme-menu, #btn-theme')) closeThemeMenu(false);
});
addEventListener('keydown', e => {
  if (themeMenu.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    previewTheme(themeSel + (e.key === 'ArrowDown' ? 1 : -1));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    closeThemeMenu(true);
  } else if (e.key === 'Escape') {
    closeThemeMenu(false);
  }
});

/* ---------- status bar ---------- */

async function refreshMetrics() {
  try {
    showMetrics(await req('api/metrics'));
  } catch {}
}
initMetricsMenu(refreshMetrics);

/* ---------- helpers ---------- */

const msg = text => {
  const el = $('#wb-msg');
  el.textContent = text || '';
  el.hidden = !text;
};

const ago = ms => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 86400 * 30) return Math.floor(s / 86400) + 'd ago';
  return new Date(ms).toLocaleDateString();
};

const tildify = p => (state.home && (p === state.home || p.startsWith(state.home + state.sep)) ? '~' + p.slice(state.home.length) : p);
const looksLikeURL = v => /^[a-z]+:\/\//i.test(v.trim());

/* ---------- folder completion ---------- */

// attachComplete turns a text input into a folder path field: as you type, it
// lists folders whose names start with the last path element. Tab (or a
// click) completes into the highlighted folder and lists its subfolders;
// Enter submits the highlighted folder if one was picked with the arrows.
function attachComplete(input, list, onFolder) {
  let items = [];
  let sel = -1;
  let seq = 0;
  let timer = 0;

  const close = () => { list.hidden = true; items = []; sel = -1; input.setAttribute('aria-expanded', 'false'); };
  const render = () => {
    const prefix = (input.value.match(/[^/\\]*$/) || [''])[0];
    list.innerHTML = items.map((e, i) => `<li class="item cursor-pointer aria-selected:bg-accent hover:bg-accent" role="option" data-i="${i}" aria-selected="${i === sel}">
      <span class="inline-flex shrink-0 text-muted-foreground">${ICON_DIR}</span>
      <span class="shrink-0 [&_b]:text-primary-text"><b>${esc(e.name.slice(0, prefix.length))}</b>${esc(e.name.slice(prefix.length))}</span>
      ${e.git ? '<span class="badge" data-variant="secondary" data-control="wb-git">git</span>' : ''}
      <span class="flex-1 min-w-0 truncate text-right text-muted-foreground">${esc(e.path)}</span></li>`).join('');
    list.hidden = !items.length;
    input.setAttribute('aria-expanded', String(!list.hidden));
    list.children[sel]?.scrollIntoView({ block: 'nearest' });
  };
  const fetchNow = async () => {
    const q = input.value;
    if (!q.trim() || looksLikeURL(q)) { close(); return; }
    const my = ++seq;
    let r;
    try {
      r = await req('api/wb/complete?' + new URLSearchParams({ q }));
    } catch { return; }
    if (my !== seq || document.activeElement !== input) return;
    items = r.entries || [];
    sel = -1;
    render();
  };
  const refresh = () => { clearTimeout(timer); timer = setTimeout(fetchNow, 60); };
  const accept = i => {
    const e = items[i];
    if (!e) return;
    input.value = e.path;
    onFolder?.(e.path);
    input.focus();
    fetchNow();
  };

  input.addEventListener('input', refresh);
  input.addEventListener('focus', () => { if (input.value) refresh(); });
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', e => {
    if (list.hidden || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length + 1) % (items.length + 1);
      if (sel === items.length) sel = -1;
      render();
    } else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      accept(sel >= 0 ? sel : 0);
    } else if (e.key === 'Enter' && sel >= 0) {
      input.value = items[sel].path;
      close();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  list.addEventListener('mousedown', e => {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    e.preventDefault(); // keep focus in the input
    accept(Number(li.dataset.i));
  });
  return { close };
}

/* ---------- recent ---------- */

// A known workspace opens by visiting its URL: the holding page there starts
// it, so plain links work, including Cmd/Ctrl-click into a new tab.
function rowHtml(it) {
  const pr = it.kind === 'pr';
  const title = pr ? (it.title || `#${it.number}`) : it.title || it.path;
  const sub = it.state === 'starting' && it.progress ? it.progress : pr ? `${it.repo}#${it.number}` : tildify(it.path);
  const st = it.state === 'stopped' && !it.error ? '' :
    `<span class="badge shrink-0" data-variant="${it.state === 'failed' ? 'destructive' : 'secondary'}" title="${esc(it.error || it.state)}">${esc(it.state === 'stopped' ? 'exited' : it.state)}</span>`;
  return `<li><a class="item group min-w-0 hover:bg-accent" data-size="xs" href="${esc(it.href)}" data-id="${esc(it.id)}">
    <span class="${pr ? 'inline-flex shrink-0 text-gi' : 'inline-flex shrink-0 text-muted-foreground'}">${pr ? ICON_PR : ICON_DIR}</span>
    <span class="flex flex-1 min-w-0 flex-col"><span class="truncate">${esc(title)}</span><span class="truncate font-mono text-xs text-muted-foreground">${esc(sub)}</span></span>
    ${st}
    <span class="shrink-0 text-xs text-muted-foreground">${esc(ago(it.lastOpened))}</span>
    <span class="flex shrink-0 gap-0.5">
      <button type="button" data-act="pin" aria-pressed="${it.pinned}" title="${it.pinned ? 'Unpin' : 'Pin to top'}" aria-label="${it.pinned ? 'Unpin' : 'Pin'}" class="btn opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 aria-pressed:opacity-100" data-variant="ghost" data-size="icon-xs"><span class="icon-[lucide--star] size-3.5 ${it.pinned ? 'text-warn' : ''}" aria-hidden="true"></span></button>
      ${it.state === 'running' ? '<button type="button" data-act="stop" title="Stop this workspace" aria-label="Stop" class="btn" data-variant="ghost" data-size="icon-xs"><span class="icon-[lucide--square] size-3 text-destructive" aria-hidden="true"></span></button>' : ''}
      <button type="button" data-act="remove" title="Remove from the list" aria-label="Remove" class="btn opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100" data-variant="ghost" data-size="icon-xs"><span class="icon-[lucide--x] size-3.5" aria-hidden="true"></span></button>
    </span>
  </a></li>`;
}

function renderRecent() {
  const pinned = state.items.filter(i => i.pinned);
  const rest = state.items.filter(i => !i.pinned);
  let html = pinned.map(rowHtml).join('');
  if (pinned.length && rest.length) html += '<li class="my-1 border-t" role="separator"></li>';
  html += rest.map(rowHtml).join('');
  $('#wb-recent').innerHTML = html;
  $('#wb-recent-empty').hidden = state.items.length > 0;
  const n = state.items.filter(i => i.state === 'running').length;
  $('#st-running').textContent = n ? `${n} running` : '';
}

async function refresh() {
  try {
    state = await req('api/wb/state');
  } catch (e) {
    msg(e.message);
    return;
  }
  // Re-render only on change, so a periodic refresh cannot swallow a click mid-press.
  const sig = JSON.stringify(state.items);
  if (sig !== lastSig) {
    lastSig = sig;
    renderRecent();
  }
  $('#st-ver').textContent = state.version ? 'v' + state.version : '';
  if (!browsePath) browse(state.cwd);
}

/* ---------- opening ---------- */

async function open(target, clone) {
  msg('');
  try {
    const r = await req('api/wb/open', clone ? { target, clone } : { target });
    if (r.needClone) {
      askForClone(target, r.repo, r.managed);
      return;
    }
    location.href = new URL(r.href, document.baseURI).href;
  } catch (e) {
    msg(e.message);
  }
}

function askForClone(prURL, repo, managed) {
  pendingPR = prURL;
  $('#wb-clone-repo').textContent = repo;
  $('#wb-clone-dest').textContent = `into ${managed}, once; later pull requests reuse it`;
  $('#wb-clone-dest').title = managed;
  $('#wb-clone').hidden = false;
  $('#wb-open-here').textContent = 'Use as clone';
  document.body.classList.add('wb-clone-mode');
  $('#wb-clone-path').value = '';
  $('#wb-clone-path').focus();
}

function cancelClone() {
  pendingPR = '';
  $('#wb-clone').hidden = true;
  $('#wb-open-here').textContent = 'Open this folder';
  document.body.classList.remove('wb-clone-mode');
}

/* ---------- browse ---------- */

async function browse(path) {
  const params = new URLSearchParams({ path });
  if ($('#wb-hidden').checked) params.set('hidden', '1');
  let r;
  try {
    r = await req('api/wb/browse?' + params);
  } catch (e) {
    msg(e.message);
    return;
  }
  browsePath = r.path;
  // rtl keeps the end of a long path visible; the bidi isolate keeps it reading left to right.
  $('#wb-path').innerHTML = `<bdi>${esc(tildify(r.path))}</bdi>`;
  $('#wb-path').title = r.path;
  $('#wb-up').disabled = !r.parent;
  $('#wb-up').dataset.path = r.parent || '';
  $('#wb-dirs').innerHTML = r.entries.length ? r.entries.map(e => `<li><div class="item group min-w-0 cursor-pointer hover:bg-accent" data-size="xs" tabindex="0" data-path="${esc(e.path)}" title="Browse ${esc(e.name)}">
    <span class="inline-flex shrink-0 text-muted-foreground">${ICON_DIR}</span>
    <span class="flex flex-1 min-w-0 flex-col"><span class="truncate">${esc(e.name)}</span></span>
    ${e.git ? '<span class="badge" data-variant="secondary" data-control="wb-git">git</span>' : ''}
    <span class="flex shrink-0 gap-1"><button type="button" data-act="open" title="Open ${esc(e.name)}" class="btn opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100" data-variant="ghost" data-size="xs">${pendingPR ? 'Use' : 'Open'}</button></span>
  </div></li>`).join('') : '<li class="empty p-4 text-muted-foreground">No folders here.</li>';
}

// Opening a folder, or, while a PR waits for its clone, choosing it as that clone.
const useFolder = path => (pendingPR ? open(pendingPR, path) : open(path));

/* ---------- wiring ---------- */

attachComplete($('#wb-target'), $('#wb-suggest'), path => browse(path));
attachComplete($('#wb-clone-path'), $('#wb-clone-suggest'), path => browse(path));

$('#wb-open').addEventListener('submit', e => {
  e.preventDefault();
  const t = $('#wb-target').value.trim();
  if (!t) return;
  cancelClone();
  open(t);
});
$('#wb-clone-form').addEventListener('submit', e => {
  e.preventDefault();
  const p = $('#wb-clone-path').value.trim();
  if (p && pendingPR) open(pendingPR, p);
});
$('#wb-clone-managed').addEventListener('click', () => pendingPR && open(pendingPR, 'managed'));
$('#wb-clone-cancel').addEventListener('click', cancelClone);
$('#wb-open-here').addEventListener('click', () => browsePath && useFolder(browsePath));
$('#wb-up').addEventListener('click', e => { const p = e.currentTarget.dataset.path; if (p) browse(p); });
$('#wb-hidden').addEventListener('change', () => browse(browsePath));

$('#wb-recent').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  e.preventDefault();
  const id = btn.closest('[data-id]').dataset.id;
  const it = state.items.find(i => i.id === id);
  try {
    if (btn.dataset.act === 'pin') await req('api/wb/pin', { id, pinned: !it?.pinned });
    else if (btn.dataset.act === 'stop') await req('api/wb/stop', { id });
    else if (btn.dataset.act === 'remove') await req('api/wb/remove', { id });
  } catch (err) {
    msg(err.message);
  }
  refresh();
});

const dirAction = (row, act) => (act === 'open' ? useFolder(row.dataset.path) : browse(row.dataset.path));
$('#wb-dirs').addEventListener('click', e => {
  const row = e.target.closest('[data-path]');
  if (!row) return;
  const btn = e.target.closest('button[data-act]');
  dirAction(row, btn ? btn.dataset.act : 'browse');
});
$('#wb-dirs').addEventListener('keydown', e => {
  const row = e.target.closest('[data-path]');
  if (row && e.key === 'Enter' && e.target === row) dirAction(row, (e.metaKey || e.ctrlKey) ? 'open' : 'browse');
});

document.addEventListener('keydown', e => {
  if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
    e.preventDefault();
    $('#wb-target').focus();
  }
});

// Keep states and the status bar current while the page is in view.
const tick = () => { if (!document.hidden) { refresh(); refreshMetrics(); } };
setInterval(tick, 2000);
document.addEventListener('visibilitychange', tick);
tick();

// ?open=<url> comes from a workspace's holding page when a PR has no known
// clone: ask for it here.
const openParam = new URLSearchParams(location.search).get('open');
if (openParam) {
  history.replaceState(null, '', location.pathname);
  $('#wb-target').value = openParam;
  open(openParam);
}
