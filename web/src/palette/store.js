import { createMemo, createResource, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import { api } from '../lib/api.js';
import { listThemes } from '../lib/theme.js';
import { createCommandRegistry } from './commands.js';
import { paletteQuery, rankCommands } from './logic.js';
/** @returns {{open:boolean,base:string,query:string,selected:number,restoreTheme:string|null}} */
function initialState() {
  return { open: false, base: 'file', query: '', selected: 0, restoreTheme: null };
}
export function createPaletteStore(editor, options = {}) {
  const request = options.request || api;
  const [state, set] = createStore(initialState());
  const commands = createCommandRegistry();
  let controller,
    latest,
    generation = 0,
    timer;
  const query = createMemo(() => paletteQuery(state.query, state.base));
  async function load(key) {
    controller?.abort();
    controller = new AbortController();
    const current = ++generation;
    const mode = key.mode,
      q = key.query;
    if (mode === 'command') return rankCommands(key.commands, q);
    if (mode === 'line') {
      const document = editor.active(),
        n = parseInt(q, 10);
      return document && n > 0
        ? [
            {
              kind: 'line',
              line: Math.min(n, document.total),
              label: 'Line ' + Math.min(n, document.total),
              sub: document.path,
            },
          ]
        : [];
    }
    if (mode === 'symbol') {
      await editor.actions.loadSymbols?.();
      return (editor.active()?.outline || [])
        .filter((symbol) => symbol.name.toLowerCase().includes(q.toLowerCase()))
        .slice(0, 400)
        .map((symbol) => ({
          kind: 'line',
          line: symbol.line,
          label: symbol.name,
          sub: symbol.kind,
        }));
    }
    if (mode === 'theme')
      return listThemes()
        .filter((theme) => (theme.name + ' ' + theme.id).toLowerCase().includes(q.toLowerCase()))
        .map((theme) => ({ kind: 'theme', id: theme.id, label: theme.name, sub: theme.scheme }));
    if (mode === 'openpr') return q ? [{ kind: 'openpr', target: q, label: 'Open PR: ' + q }] : [];
    const result = await request('api/find', { q, limit: 120 }, { signal: controller.signal });
    if (result.indexing && current === generation) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (state.open) resource.refetch();
      }, 300);
    }
    return (result.results || []).map((file) => ({
      kind: 'file',
      path: file.path,
      label: file.name,
      sub: file.path.slice(0, Math.max(0, file.path.length - file.name.length - 1)),
      positions: file.pos || [],
    }));
  }
  const [items, resource] = createResource(
    () => (state.open ? { ...query(), commands: commands.list() } : false),
    (key) => {
      latest = load(key);
      return latest;
    },
  );
  const data = () => (items.error ? [] : items() || []);
  async function openPalette(mode, seed) {
    set({
      open: true,
      base: mode,
      query: seed ?? ({ command: '>', symbol: '@', line: ':' }[mode] || ''),
      selected: 0,
      restoreTheme: mode === 'theme' ? options.theme?.current() : null,
    });
  }
  function closePalette(accepted = false) {
    if (!accepted && state.restoreTheme) options.theme?.setTheme(state.restoreTheme, false);
    generation++;
    controller?.abort();
    clearTimeout(timer);
    set({ open: false, restoreTheme: null });
  }
  async function acceptPalette(index = state.selected) {
    const version = generation;
    try {
      await latest;
    } catch {
      return;
    }
    if (!state.open || version !== generation) return;
    const item = data()[index];
    if (!item) return;
    closePalette(true);
    if (item.kind === 'file') {
      await editor.actions.openFile(item.path);
      if (editor.tree.autoReveal()) {
        await editor.actions.showFilesPanel();
        await editor.actions.revealFile(item.path);
      }
    } else if (item.kind === 'line') {
      editor.actions.patch({ cur: item.line });
      editor.actions.centerLine(item.line);
      editor.actions.pushHistory(editor.active().path, item.line);
    } else if (item.kind === 'command') item.command.run();
    else if (item.kind === 'theme') options.theme?.setTheme(item.id);
    else if (item.kind === 'openpr') editor.actions.openLegacyPR(item.target);
  }
  onCleanup(() => {
    generation++;
    controller?.abort();
    clearTimeout(timer);
  });
  return {
    state,
    query,
    items: data,
    loading: () => items.loading,
    error: () => items.error,
    commands,
    actions: {
      openPalette,
      closePalette,
      acceptPalette,
      setPaletteQuery(value) {
        set({ query: value, selected: 0 });
      },
      movePalette(delta) {
        const all = data();
        if (!all.length) return;
        const selected = (state.selected + delta + all.length) % all.length;
        set('selected', selected);
        if (query().mode === 'theme') options.theme?.setTheme(all[selected].id, false);
      },
    },
  };
}
