import { createStore, reconcile } from 'solid-js/store';
import { api, apiPostJson } from '../lib/api.js';
import { createMemo } from 'solid-js';
import { recentGroups } from './logic.js';
export function createWorkbenchStore(request = api, post = apiPostJson, navigate = href => { location.href = new URL(href, document.baseURI).href; }) {
  const [state, set] = createStore({ items: [], cwd: '', home: '', sep: '/', version: '', tab: 'recent', error: '', showAll: false, hidden: false, directory: { path: '', parent: '', entries: [] }, selected: -1, clone: null, busy: false });
  let browseSequence = 0;
  const groups = createMemo(() => recentGroups(state.items, state.showAll));
  const actions = {
    selectTab: tab => set('tab', tab), selectDirectory: index => set('selected', index), showAll: () => set('showAll', true),
    clearError: () => set('error', ''),
    async refresh() {
      try {
        const result = await request('api/wb/state');
        for (const name of ['items', 'cwd', 'home', 'sep', 'version']) if (result[name] !== undefined) set(name, reconcile(result[name]));
        if (!state.directory.path) await actions.browse(result.cwd);
      } catch (err) { set('error', err.message); }
    },
    async browse(path, select = '') {
      const seq = ++browseSequence;
      set('busy', true);
      try {
        const result = await request('api/wb/browse', { path, hidden: state.hidden ? '1' : undefined });
        if (seq !== browseSequence) return;
        set('directory', reconcile(result));
        set('selected', select ? result.entries.findIndex(e => e.path === select) : -1);
      } catch (err) { if (seq === browseSequence) set('error', err.message); }
      finally { if (seq === browseSequence) set('busy', false); }
    },
    async open(target, clone) {
      set('error', '');
      try {
        const result = await post('api/wb/open', clone ? { target, clone } : { target });
        if (result.needClone) { set('clone', { target, repo: result.repo, managed: result.managed, previousTab: state.tab }); set('tab', 'browse'); }
        else navigate(result.href);
      } catch (err) { set('error', err.message); }
    },
    useFolder: path => state.clone ? actions.open(state.clone.target, path) : actions.open(path),
    cancelClone() { const tab = state.clone?.previousTab; set('clone', null); if (tab) set('tab', tab); },
    async itemAction(action, item) {
      try { await post(`api/wb/${action}`, action === 'pin' ? { id: item.id, pinned: !item.pinned } : { id: item.id }); await actions.refresh(); }
      catch (err) { set('error', err.message); }
    },
    toggleHidden() { set('hidden', !state.hidden); return actions.browse(state.directory.path, state.directory.entries[state.selected]?.path); },
    async mkdir(path) {
      try {
        const result = await post('api/wb/mkdir', { path, base: state.directory.path });
        const at = result.path.lastIndexOf(state.sep);
        await actions.browse(at > 0 ? result.path.slice(0, at) : state.sep, result.path);
        set('error', ''); return true;
      } catch (err) { set('error', err.message); return false; }
    },
  };
  return { state, groups, actions };
}
