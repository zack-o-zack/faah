import { setMenuHidden } from './overlays.js';
// web/src/workbench.js
// The workbench page (web/workbench.html), what a bare `faah` opens. Bundled on
// its own into web/workbench.js by scripts/build-web.js. It shares the app's
// theme and status-bar metrics modules and nothing else, so it stays small.
// The server side is workbench.go and workbench_clone.go.
import { $, esc, keyLabel } from './state.js';
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

const ICON_DIR = '<span class="icon-[lucide--folder] size-4 shrink-0" aria-hidden="true"></span>';
// Recent rows show this many before "Show all".
const RECENT_SHOWN = 12;

let state = { items: [], cwd: '', home: '', sep: '/' };
let browsePath = '';
let lastSig = '';
let pendingPR = ''; // the PR URL waiting for its clone to be chosen
let showAll = false;
let tabBeforeClone = '';

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
  $('#wb-target').setAttribute('aria-invalid', String(!!text));
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
    list.innerHTML = items.map((e, i) => `<li class="item cursor-pointer aria-selected:bg-accent hover:bg-accent" data-size="xs" role="option" data-i="${i}" aria-selected="${i === sel}">
      <span class="inline-flex shrink-0 text-muted-foreground">${ICON_DIR}</span>
      <span class="shrink-0 [&_b]:text-primary-text"><b>${esc(e.name.slice(0, prefix.length))}</b>${esc(e.name.slice(prefix.length))}</span>
      ${e.git ? '<span class="badge" data-variant="secondary" data-control="wb-git">git</span>' : ''}
      <span class="flex-1 min-w-0 truncate text-right font-mono text-xs text-muted-foreground">${esc(tildify(e.path))}</span></li>`).join('') +
      (items.length ? '<li role="presentation" class="flex gap-3 border-t px-3 py-1.5 text-xs text-muted-foreground"><span><kbd class="kbd">Tab</kbd> complete</span><span><kbd class="kbd"><span class="icon-[lucide--arrow-up-down] size-3" aria-hidden="true"></span></kbd> choose</span><span><kbd class="kbd">Enter</kbd> open</span></li>' : '');
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
  const s = it.state;
  const title = pr ? (it.title || `#${it.number}`) : it.title || it.path;
  const failed = s === 'failed';
  const sub = s === 'starting' && it.progress ? it.progress : failed && it.error ? it.error : pr ? `${it.repo}#${it.number}` : tildify(it.path);
  // Pull requests are always green; a running workspace shows its stop button.
  const icon = s === 'starting'
    ? '<span class="icon-[lucide--loader-circle] size-4 animate-spin text-muted-foreground" aria-hidden="true"></span>'
    : pr ? '<span class="icon-[lucide--git-pull-request] size-4 text-gi" aria-hidden="true"></span>'
    : '<span class="icon-[lucide--folder] size-4 text-muted-foreground" aria-hidden="true"></span>';
  const act = (name, label, iconClass) => `<button type="button" data-act="${name}" title="${label}" aria-label="${label}" class="btn" data-variant="ghost" data-size="icon-xs"><span class="${iconClass}" aria-hidden="true"></span></button>`;
  const pin = it.pinned
    ? act('pin', 'Unpin', 'icon-[lucide--pin-off] size-3.5')
    : act('pin', 'Pin to the top', 'icon-[lucide--pin] size-3.5');
  return `<li><a class="item group min-w-0 hover:bg-accent/60 focus-visible:bg-accent/60" data-size="sm" href="${esc(it.href)}" data-id="${esc(it.id)}">
    <figure class="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">${icon}</figure>
    <section class="flex min-w-0 flex-1 flex-col">
      <h3 class="truncate">${esc(title)}</h3>
      <p class="truncate font-mono text-xs ${failed ? 'text-destructive' : 'text-muted-foreground'} [direction:rtl] text-left" title="${esc(failed ? it.error || '' : sub)}"><bdi>${esc(sub)}</bdi></p>
    </section>
    <aside class="flex shrink-0 items-center gap-1">
      <span class="w-16 text-right text-xs tabular-nums text-muted-foreground group-hover:hidden group-focus-within:hidden max-sm:hidden">${esc(ago(it.lastOpened))}</span>
      <span class="hidden gap-0.5 group-hover:flex group-focus-within:flex">${pin}${act('remove', 'Remove from the list', 'icon-[lucide--x] size-3.5')}</span>
      ${s === 'running' ? act('stop', 'Stop this workspace', 'icon-[lucide--square] size-3 text-destructive') : ''}
    </aside>
  </a></li>`;
}

function renderRecent() {
  const pinned = state.items.filter(i => i.pinned);
  const rest = state.items.filter(i => !i.pinned);
  const shown = showAll ? rest : rest.slice(0, Math.max(0, RECENT_SHOWN - pinned.length));
  // Pinned workspaces get their own group, so pinning reads as "keep these here".
  const heading = text => `<li role="presentation" class="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground first:pt-1">${text}</li>`;
  let html = pinned.length ? heading('Pinned') + pinned.map(rowHtml).join('') : '';
  if (pinned.length && shown.length) html += heading('Recent');
  html += shown.map(rowHtml).join('');
  $('#wb-recent').innerHTML = html;
  const hiddenCount = rest.length - shown.length;
  $('#wb-more').hidden = hiddenCount <= 0;
  $('#wb-more').textContent = `Show all ${state.items.length}`;
  $('#wb-recent-empty').hidden = state.items.length > 0;
  const n = state.items.filter(i => i.state === 'running').length;
  $('#st-running').innerHTML = n ? `<span class="size-1.5 rounded-full bg-gi"></span>${n} running` : '';
  $('#st-running').title = n ? state.items.filter(i => i.state === 'running').map(i => i.title || i.path).join('\n') : '';
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
  tabBeforeClone = currentTab();
  selectTab('browse');
  $('#wb-clone-repo').textContent = repo;
  $('#wb-clone-dest').textContent = `into ${managed}, once; later pull requests reuse it`;
  $('#wb-clone-dest').title = managed;
  $('#wb-clone').hidden = false;
  $('#wb-clone-path').value = '';
  $('#wb-clone-path').focus();
  browse(browsePath);
}

function cancelClone() {
  if (!pendingPR) return;
  pendingPR = '';
  $('#wb-clone').hidden = true;
  if (tabBeforeClone) selectTab(tabBeforeClone);
  browse(browsePath);
}

/* ---------- tabs ---------- */

const TABS = ['recent', 'browse'];
const currentTab = () => TABS.find(t => $('#wb-tab-' + t).getAttribute('aria-selected') === 'true');

function selectTab(name) {
  for (const t of TABS) {
    const on = t === name;
    $('#wb-tab-' + t).setAttribute('aria-selected', String(on));
    $('#wb-tab-' + t).tabIndex = on ? 0 : -1;
    $('#wb-panel-' + t).hidden = !on;
  }
}

/* ---------- browse ---------- */

// Browse works like a file manager's list: a click or Enter goes into a
// folder, the arrows select one, Backspace goes up, and Open acts on the
// selection, or on the folder being shown when nothing is selected.
let dirEntries = [];
let dirSel = -1;

function renderPath(path) {
  const home = state.home;
  const inHome = home && (path === home || path.startsWith(home + state.sep));
  const rest = (inHome ? path.slice(home.length) : path).split(state.sep).filter(Boolean);
  let at = inHome ? home : '';
  const crumbs = [{ name: inHome ? '~' : state.sep, path: inHome ? home : state.sep }];
  for (const part of rest) {
    at = at + state.sep + part;
    crumbs.push({ name: part, path: at });
  }
  const el = $('#wb-path');
  el.innerHTML = crumbs.map((c, i) => (i ? '<span class="icon-[lucide--chevron-right] size-3.5 shrink-0 text-muted-foreground" aria-hidden="true"></span>' : '') +
    `<button type="button" data-path="${esc(c.path)}" class="btn shrink-0 ${i === crumbs.length - 1 ? 'text-foreground' : 'text-muted-foreground'}" data-variant="ghost" data-size="xs"${i === crumbs.length - 1 ? ' aria-current="location"' : ''}>${esc(c.name)}</button>`).join('');
  el.scrollLeft = el.scrollWidth;
}

function renderDirs() {
  $('#wb-dirs').innerHTML = dirEntries.length ? dirEntries.map((e, i) => `<li role="option" id="wb-dir-${i}" data-i="${i}" aria-selected="${i === dirSel}" class="${e.name.startsWith('.') ? 'opacity-50 ' : ''}flex h-7 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-sm hover:bg-accent/60 aria-selected:bg-accent">
    <span class="icon-[lucide--folder] size-4 shrink-0 text-muted-foreground" aria-hidden="true"></span>
    <span class="min-w-0 flex-1 truncate">${esc(e.name)}</span>
    ${e.git ? '<span class="text-xs opacity-70">git</span>' : ''}
  </li>`).join('') : '<li class="py-8 text-center text-sm text-muted-foreground">No folders here.</li>';
  const sel = dirEntries[dirSel];
  if (sel) $('#wb-dirs').setAttribute('aria-activedescendant', 'wb-dir-' + dirSel);
  else $('#wb-dirs').removeAttribute('aria-activedescendant');
  $('#wb-dir-' + dirSel)?.scrollIntoView({ block: 'nearest' });
  const verb = pendingPR ? 'Use' : 'Open';
  $('#wb-open-here').textContent = sel ? `${verb} ${sel.name}` : pendingPR ? 'Use this folder' : 'Open this folder';
}

async function browse(path, select = '') {
  const params = new URLSearchParams({ path });
  // Shown hidden folders are dimmed, the way a file manager shows them.
  if ($('#wb-hidden').getAttribute('aria-pressed') === 'true') params.set('hidden', '1');
  let r;
  // The old list stays, dimmed, until the new one arrives.
  $('#wb-dirs').classList.add('opacity-60');
  try {
    r = await req('api/wb/browse?' + params);
  } catch (e) {
    msg(e.message);
    return;
  } finally {
    $('#wb-dirs').classList.remove('opacity-60');
  }
  browsePath = r.path;
  renderPath(r.path);
  $('#wb-up').disabled = !r.parent;
  $('#wb-up').dataset.path = r.parent || '';
  dirEntries = r.entries;
  dirSel = select ? dirEntries.findIndex(e => e.path === select) : -1;
  renderDirs();
}

// Opening a folder, or, while a PR waits for its clone, choosing it as that clone.
const useFolder = path => (pendingPR ? open(pendingPR, path) : open(path));

/* ---------- wiring ---------- */

// The field's icon says what it recognised: a pull request, a folder, or nothing yet.
const kindIcon = v => (looksLikeURL(v) ? 'icon-[lucide--git-pull-request]' : v.trim() ? 'icon-[lucide--folder]' : 'icon-[lucide--search]');
$('#wb-target').addEventListener('input', e => {
  $('#wb-kind').className = kindIcon(e.target.value) + ' size-4';
  msg('');
});

for (const t of TABS) $('#wb-tab-' + t).addEventListener('click', () => selectTab(t));
$('#wb-tabs [role=tablist]').addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const next = TABS[(TABS.indexOf(currentTab()) + 1) % TABS.length];
  selectTab(next);
  $('#wb-tab-' + next).focus();
});
$('#wb-go-browse').addEventListener('click', () => selectTab('browse'));
$('#wb-more').addEventListener('click', () => { showAll = true; renderRecent(); });

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
$('#wb-open-here').addEventListener('click', () => useFolder(dirEntries[dirSel]?.path || browsePath));
$('#wb-up').addEventListener('click', e => { const p = e.currentTarget.dataset.path; if (p) browse(p); });

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

for (const k of document.querySelectorAll('kbd[data-keys]')) k.textContent = keyLabel(k.dataset.keys);
const selectDir = i => { dirSel = i; renderDirs(); };
$('#wb-dirs').addEventListener('click', e => {
  const row = e.target.closest('[data-i]');
  if (row) browse(dirEntries[Number(row.dataset.i)].path);
});
$('#wb-dirs').addEventListener('keydown', e => {
  const n = dirEntries.length;
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n && !e.metaKey) {
    e.preventDefault();
    selectDir(dirSel < 0 ? 0 : Math.min(n - 1, Math.max(0, dirSel + (e.key === 'ArrowDown' ? 1 : -1))));
  } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    useFolder(dirEntries[dirSel]?.path || browsePath);
  } else if ((e.key === 'Enter' || e.key === 'ArrowRight' || (e.metaKey && e.key === 'ArrowDown')) && dirEntries[dirSel]) {
    e.preventDefault();
    browse(dirEntries[dirSel].path);
  } else if ((e.key === 'Backspace' || e.key === 'ArrowLeft' || (e.metaKey && e.key === 'ArrowUp')) && $('#wb-up').dataset.path) {
    e.preventDefault();
    browse($('#wb-up').dataset.path);
  } else if (e.key === 'Escape' && dirSel >= 0) {
    selectDir(-1);
  } else if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey) {
    // Typing a letter jumps to the first folder starting with it.
    const i = dirEntries.findIndex(d => d.name.toLowerCase().startsWith(e.key.toLowerCase()));
    if (i >= 0) selectDir(i);
  }
});
function toggleHidden() {
  const btn = $('#wb-hidden');
  const on = btn.getAttribute('aria-pressed') !== 'true';
  btn.setAttribute('aria-pressed', String(on));
  btn.firstElementChild.className = (on ? 'icon-[lucide--eye]' : 'icon-[lucide--eye-off]') + ' size-4';
  browse(browsePath, dirEntries[dirSel]?.path);
}
$('#wb-hidden').addEventListener('click', toggleHidden);
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === '.' || e.key === '>') && !$('#wb-panel-browse').hidden) {
    e.preventDefault();
    toggleHidden();
  }
});

// New folder: a row at the top of the list takes a name, or a ~ or absolute
// path for a folder somewhere else. Enter creates it and selects it.
function startMkdir() {
  if ($('#wb-mkdir-row')) { $('#wb-mkdir-row input').focus(); return; }
  $('#wb-dirs').insertAdjacentHTML('afterbegin', `<li id="wb-mkdir-row" class="flex h-8 items-center gap-2 px-2">
    <span class="icon-[lucide--folder-plus] size-4 shrink-0 text-muted-foreground" aria-hidden="true"></span>
    <input type="text" spellcheck="false" autocapitalize="off" class="input h-7 min-w-0 flex-1 text-sm" placeholder="Folder name, or a path like ~/code/new-project" aria-label="New folder name or path">
  </li>`);
  const input = $('#wb-mkdir-row input');
  input.focus();
  input.addEventListener('keydown', async e => {
    e.stopPropagation();
    if (e.key === 'Escape') { $('#wb-mkdir-row').remove(); $('#wb-dirs').focus(); return; }
    if (e.key !== 'Enter' || !input.value.trim()) return;
    e.preventDefault();
    try {
      const r = await req('api/wb/mkdir', { path: input.value.trim(), base: browsePath });
      const at = r.path.lastIndexOf(state.sep);
      await browse(at > 0 ? r.path.slice(0, at) : state.sep, r.path);
      msg('');
      $('#wb-dirs').focus();
    } catch (err) {
      input.setAttribute('aria-invalid', 'true');
      msg(err.message);
    }
  });
  input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
}
$('#wb-mkdir').addEventListener('click', startMkdir);

$('#wb-path').addEventListener('click', e => {
  const b = e.target.closest('button[data-path]');
  if (b) browse(b.dataset.path);
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
