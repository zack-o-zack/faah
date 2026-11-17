import type { Request } from '../lib/api.ts';
import type { Directory, DirectoryEntry, RecentItem } from './decode.ts';
import { decodeWorkbench, decodeDirectory, decodeOpen, decodeMkdir } from './decode.ts';
import { errorMessage } from '../lib/decode.ts';
interface WorkbenchState {
  items: RecentItem[];
  cwd: string;
  home: string;
  sep: string;
  version: string;
  tab: string;
  error: string;
  showAll: boolean;
  hidden: boolean;
  directory: Directory;
  selected: number;
  selectionSource: 'navigation' | 'user';
  preview: { path: string; entries: DirectoryEntry[]; busy: boolean; error: string };
  clone: { target: string; repo: string; managed: string; previousTab: string } | null;
  busy: boolean;
}
import { createStore, reconcile } from 'solid-js/store';
import { api, apiPostJson } from '../lib/api.ts';
import { batch, createMemo, getOwner, onCleanup } from 'solid-js';
import { recentGroups } from './logic.ts';

function initialState(): WorkbenchState {
  return {
    items: [],
    cwd: '',
    home: '',
    sep: '/',
    version: '',
    tab: 'recent',
    error: '',
    showAll: false,
    hidden: false,
    directory: { path: '', parent: '', entries: [] },
    selected: -1,
    selectionSource: 'navigation',
    preview: { path: '', entries: [], busy: false, error: '' },
    clone: null,
    busy: false,
  };
}

export function createWorkbenchStore(
  request: Request = api,
  post: Request = apiPostJson,
  navigate = (href: string): void => {
    location.href = new URL(href, document.baseURI).href;
  },
): ReturnType<typeof buildWorkbenchStore> {
  return buildWorkbenchStore(request, post, navigate);
}
function buildWorkbenchStore(
  request: Request = api,
  post: Request = apiPostJson,
  navigate = (href: string): void => {
    location.href = new URL(href, document.baseURI).href;
  },
) {
  const [state, set] = createStore(initialState());
  // Ignore stale responses when a newer browse request has already started.
  let browseSequence = 0;
  let refreshSequence = 0;
  let openSequence = 0;
  let previewSequence = 0;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  const previewCache = new Map<string, DirectoryEntry[]>();
  function cancelPreview() {
    ++previewSequence;
    clearTimeout(previewTimer);
  }
  function invalidatePreview() {
    cancelPreview();
    previewCache.clear();
    set('preview', { path: '', entries: [], busy: false, error: '' });
  }
  function previewSelection() {
    const path = state.directory.entries[state.selected]?.path || '';
    if (path === state.preview.path && !state.preview.error) return;
    cancelPreview();
    const cached = previewCache.get(path);
    set('preview', { path, entries: cached || [], busy: !!path && !cached, error: '' });
    if (!path) return;
    if (cached) {
      previewCache.delete(path);
      previewCache.set(path, cached);
      return;
    }
    const sequence = previewSequence;
    const hidden = state.hidden;
    previewTimer = setTimeout(async () => {
      try {
        const result = decodeDirectory(
          await request('api/wb/browse', { path, hidden: hidden ? '1' : undefined }),
        );
        if (sequence !== previewSequence) return;
        previewCache.set(path, result.entries);
        if (previewCache.size > 20) {
          const oldest = previewCache.keys().next().value;
          if (oldest !== undefined) previewCache.delete(oldest);
        }
        set('preview', { path, entries: result.entries, busy: false, error: '' });
      } catch (err) {
        if (sequence === previewSequence)
          set('preview', { path, entries: [], busy: false, error: errorMessage(err) });
      }
    }, 80);
  }
  if (getOwner()) onCleanup(cancelPreview);
  const groups = createMemo(() => recentGroups(state.items, state.showAll));
  // Only an explicit selection changes the Open target.
  const openEntry = createMemo(() =>
    state.selectionSource === 'user' ? state.directory.entries[state.selected] : undefined,
  );
  const actions = {
    selectTab: (tab: string) => set('tab', tab),
    selectDirectory: (index: number) => {
      batch(() => {
        set('selected', index);
        set('selectionSource', 'user');
        previewSelection();
      });
    },
    showAll: () => set('showAll', true),
    clearError: () => set('error', ''),
    async refresh() {
      const sequence = ++refreshSequence;
      try {
        const result = decodeWorkbench(await request('api/wb/state'));
        if (sequence !== refreshSequence) return;
        if (result.items !== undefined) set('items', reconcile(result.items));
        if (result.cwd !== undefined) set('cwd', result.cwd);
        if (result.home !== undefined) set('home', result.home);
        if (result.sep !== undefined) set('sep', result.sep);
        if (result.version !== undefined) set('version', result.version);
        if (!state.directory.path) await actions.browse(result.cwd);
      } catch (err) {
        if (sequence === refreshSequence) set('error', errorMessage(err));
      }
    },
    async browse(path?: string, select = ''): Promise<void> {
      const seq = ++browseSequence;
      set('busy', true);
      try {
        const result = decodeDirectory(
          await request('api/wb/browse', {
            path,
            hidden: state.hidden ? '1' : undefined,
          }),
        );
        if (seq !== browseSequence) return;
        const sameDirectory = result.path === state.directory.path;
        const selection =
          select ||
          (sameDirectory ? state.directory.entries[state.selected]?.path : '') ||
          (result.path === state.directory.parent ? state.directory.path : '');
        const index = result.entries.findIndex((entry) => entry.path === selection);
        let source = state.selectionSource;
        if (select) source = 'user';
        else if (!sameDirectory) source = 'navigation';
        batch(() => {
          set('directory', reconcile(result));
          set('selected', index);
          set('selectionSource', source);
          previewSelection();
        });
      } catch (err) {
        if (seq === browseSequence) set('error', errorMessage(err));
      } finally {
        if (seq === browseSequence) set('busy', false);
      }
    },
    async open(target: string, clone?: string): Promise<void> {
      const sequence = ++openSequence;
      set('error', '');
      try {
        const result = decodeOpen(
          await post('api/wb/open', clone ? { target, clone } : { target }),
        );
        if (sequence !== openSequence) return;
        if (result.needClone) {
          set('clone', {
            target,
            repo: result.repo,
            managed: result.managed,
            previousTab: state.tab,
          });
          set('tab', 'browse');
        } else navigate(result.href);
      } catch (err) {
        if (sequence === openSequence) set('error', errorMessage(err));
      }
    },
    useFolder: (path: string) =>
      state.clone ? actions.open(state.clone.target, path) : actions.open(path),
    cancelClone() {
      const tab = state.clone?.previousTab;
      set('clone', null);
      if (tab) set('tab', tab);
    },
    async itemAction(action: string, item: RecentItem): Promise<void> {
      try {
        await post(
          `api/wb/${action}`,
          action === 'pin' ? { id: item.id, pinned: !item.pinned } : { id: item.id },
        );
        await actions.refresh();
      } catch (err) {
        set('error', errorMessage(err));
      }
    },
    toggleHidden() {
      set('hidden', !state.hidden);
      invalidatePreview();
      return actions.browse(state.directory.path);
    },
    async mkdir(path: string): Promise<boolean> {
      try {
        const result = decodeMkdir(
          await post('api/wb/mkdir', { path, base: state.directory.path }),
        );
        invalidatePreview();
        const at = result.path.lastIndexOf(state.sep);
        await actions.browse(at > 0 ? result.path.slice(0, at) : state.sep, result.path);
        set('error', '');
        return true;
      } catch (err) {
        set('error', errorMessage(err));
        return false;
      }
    },
  };
  return { state, groups, openEntry, actions };
}
