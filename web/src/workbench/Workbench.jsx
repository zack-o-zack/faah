import { createMemo, createResource, createSignal, For, onMount, Show } from 'solid-js';
import { useWorkbench } from './context.jsx';
import { PathInput } from './PathInput.jsx';
import { ago, breadcrumbs, fieldKind, tildify } from './logic.js';
import { api } from '../lib/api.js';
import { createPolling } from '../lib/events.js';
import { createShortcut, Kbd } from '../lib/shortcuts.jsx';
import { DropdownMenu } from '../lib/components.jsx';
import { useTheme } from '../lib/theme-context.jsx';

export function ThemeMenu() {
  const theme = useTheme();
  const [before, setBefore] = createSignal(null);
  return <DropdownMenu label="Select theme" onOpen={() => setBefore(theme.preference())} onClose={reason => { if (reason !== 'select' && before()) theme.setTheme(before(), false); setBefore(null); }}><For each={[{ id: 'system', name: 'System' }, ...theme.themes()]}>{item => <button class="btn w-full" role="menuitemradio" aria-checked={theme.current() === item.id} onFocus={() => { if (!before()) setBefore(theme.preference()); theme.setTheme(item.id, false); }} onMouseEnter={() => { if (!before()) setBefore(theme.preference()); theme.setTheme(item.id, false); }} onClick={() => { theme.setTheme(item.id); setBefore(null); }} onKeyDown={e => { if (e.key === 'Escape' && before()) { theme.setTheme(before(), false); setBefore(null); } }}>{item.name}</button>}</For></DropdownMenu>;
}
function RecentRow(props) {
  const { state, actions } = useWorkbench();
  const item = () => props.item;
  return <li><div class="item min-w-0" data-size="sm">
    <a class="min-w-0 flex-1" href={item().href}>
      <h3 class="truncate">{item().title || item().path || `#${item().number}`}</h3>
      <p class="truncate text-xs text-muted-foreground">{item().state === 'failed' ? item().error : item().state === 'starting' ? item().progress : item().kind === 'pr' ? `${item().repo}#${item().number}` : tildify(item().path, state.home, state.sep)}</p>
    </a>
    <span class="text-xs text-muted-foreground max-sm:hidden">{ago(item().lastOpened)}</span>
    <button class="btn" data-variant="ghost" aria-label={item().pinned ? 'Unpin' : 'Pin to the top'} onClick={() => actions.itemAction('pin', item())}><span class={item().pinned ? 'icon-[lucide--pin-off] size-4' : 'icon-[lucide--pin] size-4'} /></button>
    <button class="btn" data-variant="ghost" aria-label="Remove from the list" onClick={() => actions.itemAction('remove', item())}><span class="icon-[lucide--x] size-4" /></button>
    <Show when={item().state === 'running'}><button class="btn" data-variant="ghost" aria-label="Stop this workspace" onClick={() => actions.itemAction('stop', item())}><span class="icon-[lucide--square] size-4 text-destructive" /></button></Show>
  </div></li>;
}
function Recent() {
  const { state, groups, actions } = useWorkbench();
  return <><ul class="item-group">
    <Show when={groups().pinned.length}><li class="text-xs text-muted-foreground">Pinned</li></Show>
    <For each={groups().pinned}>{item => <RecentRow item={item} />}</For>
    <Show when={groups().pinned.length && groups().recent.length}><li class="text-xs text-muted-foreground">Recent</li></Show>
    <For each={groups().recent}>{item => <RecentRow item={item} />}</For>
  </ul>
  <Show when={groups().pinned.length + groups().recent.length < groups().total}><button class="btn" data-variant="ghost" onClick={actions.showAll}>Show all {groups().total}</button></Show>
  <Show when={!state.items.length}><div class="empty py-12"><header><h2>Nothing opened yet</h2><p>Paste a pull request URL or a folder path above, or find the folder in Browse.</p></header><footer><button class="btn" data-variant="outline" onClick={() => actions.selectTab('browse')}>Browse folders</button></footer></div></Show></>;
}
function Browse() {
  const { state, actions } = useWorkbench();
  const [mkdir, setMkdir] = createSignal(false);
  const [name, setName] = createSignal('');
  let list;
  const selected = () => state.directory.entries[state.selected];
  const useFolder = () => actions.useFolder(selected()?.path || state.directory.path);
  const keydown = e => {
    if (e.target.tagName === 'INPUT') return;
    const entries = state.directory.entries;
    if (['ArrowDown', 'ArrowUp'].includes(e.key) && !e.metaKey) { e.preventDefault(); actions.selectDirectory(Math.max(0, Math.min(entries.length - 1, state.selected + (e.key === 'ArrowDown' ? 1 : -1)))); }
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); useFolder(); }
    else if (['Enter', 'ArrowRight'].includes(e.key) || (e.metaKey && e.key === 'ArrowDown')) { e.preventDefault(); if (selected()) actions.browse(selected().path); }
    else if (['Backspace', 'ArrowLeft'].includes(e.key) || (e.metaKey && e.key === 'ArrowUp')) { e.preventDefault(); if (state.directory.parent) actions.browse(state.directory.parent); }
    else if (e.key === 'Escape') actions.selectDirectory(-1);
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) { const i = entries.findIndex(item => item.name.toLowerCase().startsWith(e.key.toLowerCase())); if (i >= 0) actions.selectDirectory(i); }
  };
  return <div class="flex min-h-0 flex-1 flex-col gap-2">
    <div class="flex flex-wrap items-center gap-2 border-b p-2">
      <button class="btn" aria-label="Back to the parent folder" disabled={!state.directory.parent} onClick={() => actions.browse(state.directory.parent)}>Up</button>
      <nav class="flex min-w-0 flex-1 overflow-auto" aria-label="Folder path"><For each={breadcrumbs(state.directory.path, state.home, state.sep)}>{crumb => <button class="btn shrink-0" data-variant="ghost" onClick={() => actions.browse(crumb.path)}>{crumb.name}</button>}</For></nav>
      <button class="btn" aria-label="New folder" onClick={() => setMkdir(true)}><span class="icon-[lucide--folder-plus] size-4" /></button>
      <button class="btn" aria-label="Show hidden folders" aria-pressed={state.hidden} onClick={actions.toggleHidden}><span class="icon-[lucide--eye] size-4" /></button>
      <button class="btn" data-variant="secondary" onClick={useFolder}>{state.clone ? 'Use' : 'Open'} {selected()?.name || 'this folder'}</button>
    </div>
    <Show when={mkdir()}><form class="flex gap-2" onSubmit={async e => { e.preventDefault(); if (name().trim() && await actions.mkdir(name().trim())) { setMkdir(false); setName(''); list.focus(); } }}>
      <input class="input" aria-label="New folder name or path" placeholder="Folder name, or a path like ~/code/new-project" ref={el => queueMicrotask(() => el.focus())} value={name()} onInput={e => setName(e.currentTarget.value)} onKeyDown={e => { if (e.key === 'Escape') { setMkdir(false); list.focus(); } }} /><button class="btn">Create folder</button>
    </form></Show>
    <ul ref={list} role="listbox" tabindex="0" aria-label="Folders" aria-busy={state.busy} aria-activedescendant={state.selected >= 0 ? `folder-${state.selected}` : undefined} class="min-h-0 flex-1 overflow-auto p-1" onKeyDown={keydown}>
      <For each={state.directory.entries} fallback={<li class="p-8 text-muted-foreground">No folders here.</li>}>{(entry, index) => <li id={`folder-${index()}`} role="option" aria-selected={index() === state.selected} class="flex cursor-pointer items-center gap-2 rounded-md p-2 hover:bg-accent aria-selected:bg-accent" classList={{ 'opacity-50': entry.name.startsWith('.') }} onClick={() => actions.browse(entry.path)}>
        <span class={entry.git ? 'icon-[lucide--folder-git-2] size-4 text-gi' : 'icon-[lucide--folder] size-4'} aria-hidden="true" />{entry.name}
      </li>}</For>
    </ul><p class="text-xs text-muted-foreground">Enter goes into a folder, Backspace goes up, <Kbd combo="Mod+Enter" /> opens it.</p>
  </div>;
}
function Clone() {
  const { state, actions } = useWorkbench();
  const [path, setPath] = createSignal('');
  return <section class="flex flex-col gap-3 rounded-lg border bg-card p-4"><header><h2>No local clone of {state.clone.repo} found</h2><p class="text-sm text-muted-foreground">Pull requests open as git worktrees of one clone. Point faah at your clone, pick it in Browse, or let faah make one.</p></header>
    <form class="flex gap-2" onSubmit={e => { e.preventDefault(); if (path().trim()) actions.open(state.clone.target, path().trim()); }}><PathInput value={path()} onInput={setPath} onFolder={actions.browse} label="Folder of your local clone" placeholder="~/path/to/your/clone" inputRef={el => queueMicrotask(() => el.focus())} /><button class="btn">Use this clone</button></form>
    <footer class="flex flex-wrap gap-2"><button class="btn" onClick={() => actions.open(state.clone.target, 'managed')}>Let faah clone it</button><span class="text-xs text-muted-foreground">into {state.clone.managed}, once; later pull requests reuse it</span><button class="btn" data-variant="ghost" onClick={actions.cancelClone}>Cancel</button></footer>
  </section>;
}
export function Workbench() {
  const { state, actions } = useWorkbench();
  const [target, setTarget] = createSignal('');
  const kind = createMemo(() => fieldKind(target()));
  const label = () => kind() === 'pr' ? 'Open PR' : kind() === 'dir' ? 'Open folder' : 'Open';
  const [metrics, { refetch }] = createResource(async () => { try { return await api('api/metrics'); } catch { return null; } });
  let input;
  createPolling(async () => { await actions.refresh(); await refetch(); }, 2000);
  createShortcut('/', () => input.focus());
  createShortcut('Mod+Shift+.', actions.toggleHidden, { when: () => state.tab === 'browse', inputs: true });
  onMount(() => {
    input.focus();
    const open = new URLSearchParams(location.search).get('open');
    if (open) { history.replaceState(null, '', location.pathname); setTarget(open); void actions.open(open); }
  });
  return <div class="flex h-dvh flex-col">
    <button data-desktop-menu class="btn desktop-menu-btn hidden! win-linux:inline-flex!" aria-label="Application menu"><span class="icon-[lucide--menu] size-4" /></button>
    <main class="mx-auto flex min-h-0 w-full max-w-[720px] flex-1 flex-col gap-4 px-4 pt-14 pb-6">
      <header class="flex items-center gap-2"><img class="hidden h-5 dark:block" src="static/logo-dark.svg" alt="faah" /><img class="h-5 dark:hidden" src="static/logo-light.svg" alt="faah" /><span class="text-xs text-muted-foreground">{state.version && `v${state.version}`}</span></header>
      <form class="flex gap-2" onSubmit={e => { e.preventDefault(); actions.cancelClone(); if (['dir', 'pr'].includes(kind())) actions.open(target().trim()); }}>
        <PathInput value={target()} onInput={value => { setTarget(value); actions.clearError(); }} onFolder={actions.browse} inputRef={el => { input = el; }} label="Folder path or pull request URL" placeholder="Folder path or pull request URL" /><button class="btn" data-variant="primary" disabled={!['pr', 'dir'].includes(kind())}>{label()}</button>
      </form>
      <Show when={state.error}><p role="alert" class="text-sm text-destructive">{state.error}</p></Show>
      <Show when={state.clone}><Clone /></Show>
      <div class="tabs min-h-0 flex-1"><nav role="tablist" aria-label="Workspaces" data-variant="line" onKeyDown={e => {
        if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); const tab = state.tab === 'recent' ? 'browse' : 'recent'; actions.selectTab(tab); e.currentTarget.querySelector(`[aria-controls="panel-${tab}"]`).focus(); }
      }}><For each={['recent', 'browse']}>{tab => <button class="capitalize" id={`tab-${tab}`} role="tab" tabindex={state.tab === tab ? 0 : -1} aria-selected={state.tab === tab} aria-controls={`panel-${tab}`} onClick={() => actions.selectTab(tab)}>{tab}</button>}</For></nav>
      <div role="tabpanel" id={`panel-${state.tab}`} aria-labelledby={`tab-${state.tab}`} class="flex min-h-0 flex-1 flex-col overflow-auto"><Show when={state.tab === 'recent'} fallback={<Browse />}><Recent /></Show></div></div>
    </main>
    <footer class="flex shrink-0 items-center gap-2 border-t bg-sidebar px-2 py-1 text-xs text-muted-foreground">
      <span>{state.items.filter(item => item.state === 'running').length} running</span><span class="flex-1" />
      <DropdownMenu label="Process metrics"><div class="p-2">CPU {metrics()?.cpuUsage?.toFixed(1) ?? '--'}% · RAM {metrics() ? Math.round(metrics().rssBytes / 1048576) : '--'} MB<Show when={metrics()?.lspMemBytes}> · LSP {Math.round(metrics().lspMemBytes / 1048576)} MB</Show><p>Goroutines {metrics()?.goroutines ?? 0}</p><For each={metrics()?.parts || []}>{part => <p>{part.name}: {Math.round((part.rssBytes || 0) / 1048576)} MB · {(part.cpuUsage || 0).toFixed(1)}%</p>}</For></div></DropdownMenu>
      <a class="btn" data-variant="ghost" href="https://github.com/zack-o-zack/faah" target="_blank" rel="noopener" aria-label="faah on GitHub"><span class="icon-[lucide--github] size-4" /></a><ThemeMenu />
    </footer>
  </div>;
}
