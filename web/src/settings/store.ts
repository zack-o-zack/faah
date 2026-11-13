import { batch, createMemo, onCleanup } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { api, apiPostJson } from '../lib/api.js';
import { toast } from '../lib/toast.jsx';
import {
  COMMONLY_USED,
  categories,
  parseNumberInput,
  parseSavedSettings,
  parseSettingsReply,
  preferences,
  validRawSettings,
  visibleSettings,
  type SettingItem,
  type SettingValue,
  type SettingsValues,
} from './logic.ts';

export type SettingsMode = 'ui' | 'json';
export type SaveStatus =
  | { status: 'saved'; message: string }
  | { status: 'unsaved' }
  | { status: 'saving' }
  | { status: 'error'; message: string };

export interface SettingsDialog {
  open: boolean;
  mode: SettingsMode;
  category: string;
  query: string;
  /** A setting to scroll to and focus once its card renders. */
  focus: string;
  raw: string;
  rawError: string;
  rawNotice: string;
}

export interface SettingsState {
  loaded: boolean;
  loadError: string;
  schema: SettingItem[];
  defaults: SettingsValues;
  values: SettingsValues;
  raw: string;
  path: string;
  /** Typed but not yet committed values, saved by Save or Mod+S; undefined deletes an entry. */
  edits: Record<string, SettingValue | undefined>;
  invalid: Record<string, string | undefined>;
  save: SaveStatus;
  dialog: SettingsDialog;
}

export interface SettingsOptions {
  request?: (path: string, signal: AbortSignal) => Promise<unknown>;
  post?: (path: string, body: unknown, signal: AbortSignal) => Promise<unknown>;
}

/** Told which keys a save wrote, for state the server derives from them (the agent harness). */
export type SavedListener = (keys: string[]) => void;

function initialState(): SettingsState {
  return {
    loaded: false,
    loadError: '',
    schema: [],
    defaults: {},
    values: {},
    raw: '{\n}\n',
    path: '',
    edits: {},
    invalid: {},
    save: { status: 'saved', message: 'All changes saved' },
    dialog: {
      open: false,
      mode: 'ui',
      category: COMMONLY_USED,
      query: '',
      focus: '',
      raw: '',
      rawError: '',
      rawNotice: '',
    },
  };
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : 'unknown error';
const aborted = (error: unknown): boolean => error instanceof Error && error.name === 'AbortError';

/** Settings from /api/settings: the dialog's state, the values, and what the app derives from them. */
export function createSettingsStore(options: SettingsOptions = {}) {
  const request = options.request ?? ((path, signal) => api(path, undefined, { signal }));
  const post = options.post ?? ((path, body, signal) => apiPostJson(path, body, { signal }));
  const [state, set] = createStore(initialState());
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  let saveVersion = 0;
  const listeners = new Set<SavedListener>();

  const prefs = createMemo(() => preferences(state.values));
  const categoryList = createMemo(() => categories(state.schema));
  const visible = createMemo(() =>
    visibleSettings(state.schema, state.dialog.category, state.dialog.query),
  );
  const value = (key: string): SettingValue | null =>
    state.values[key] ?? state.defaults[key] ?? null;

  function accept(values: SettingsValues, raw: string): void {
    set('values', reconcile(values));
    if (raw) set('raw', raw);
  }

  async function loadSettings(): Promise<void> {
    try {
      const reply = parseSettingsReply(await request('api/settings', controller.signal));
      batch(() => {
        set({
          loaded: true,
          loadError: '',
          schema: reply.schema,
          defaults: reply.defaults,
          path: reply.path,
        });
        accept(reply.values, reply.raw);
      });
    } catch (error) {
      if (!aborted(error)) set('loadError', message(error));
    }
  }

  async function write(body: SettingsValues | { raw: string }, keys: string[]): Promise<boolean> {
    const version = ++saveVersion;
    set('save', { status: 'saving' });
    try {
      const reply = parseSavedSettings(await post('api/settings', body, controller.signal));
      if (version !== saveVersion) return true;
      batch(() => {
        accept(reply.values, reply.raw);
        set('save', { status: 'saved', message: 'All changes saved' });
      });
      for (const listener of listeners) listener(keys);
      return true;
    } catch (error) {
      if (aborted(error)) return false;
      if (version === saveVersion)
        set('save', { status: 'error', message: 'Failed to save: ' + message(error) });
      return false;
    }
  }

  /** Saves one setting at once: switches, choices and committed fields. */
  async function setSetting(key: string, next: SettingValue): Promise<void> {
    batch(() => {
      set('values', key, next);
      set('edits', key, undefined);
      set('invalid', key, undefined);
    });
    await write({ [key]: next }, [key]);
  }

  function commitNumber(item: SettingItem, input: string): void {
    const parsed = parseNumberInput(input, item);
    if (parsed.ok) {
      void setSetting(item.key, parsed.value);
      return;
    }
    batch(() => {
      set('edits', item.key, undefined);
      set('invalid', item.key, parsed.error);
    });
  }

  async function saveSettings(): Promise<void> {
    if (state.dialog.mode === 'json') return saveRawSettings();
    const edits: SettingsValues = {};
    for (const [key, next] of Object.entries(state.edits))
      if (next !== undefined) edits[key] = next;
    const body = Object.keys(edits).length ? edits : { ...state.values };
    batch(() => {
      for (const [key, next] of Object.entries(edits)) set('values', key, next);
    });
    if (await write(body, Object.keys(body))) {
      set('edits', reconcile({}));
      set('save', { status: 'saved', message: 'Settings saved successfully' });
      toast('success', 'Settings saved');
    } else toast('error', 'Failed to save settings');
  }

  async function saveRawSettings(): Promise<void> {
    const raw = state.dialog.raw;
    const invalid = validRawSettings(raw);
    if (invalid) {
      batch(() => {
        set('dialog', { rawError: invalid, rawNotice: '' });
        set('save', { status: 'error', message: 'JSON syntax error' });
      });
      return;
    }
    set('dialog', { rawError: '', rawNotice: '' });
    if (await write({ raw }, Object.keys(state.values))) {
      batch(() => {
        set('dialog', { raw: state.raw, rawNotice: 'Settings saved successfully.' });
        set('save', { status: 'saved', message: 'Settings saved successfully' });
      });
      toast('success', 'Settings saved');
    } else if (state.save.status === 'error') set('dialog', 'rawError', state.save.message);
  }

  function setSettingsMode(mode: SettingsMode): void {
    set('dialog', { mode, raw: state.raw, rawError: '', rawNotice: '' });
  }

  function openSettings(mode: SettingsMode = 'ui', category = '', key = ''): void {
    batch(() => {
      set('dialog', { open: true, focus: key });
      setSettingsMode(mode);
      if (category) set('dialog', { category, query: '' });
      set('edits', reconcile({}));
      set('save', { status: 'saved', message: 'All changes saved' });
    });
    // Re-read: another window or an editor may have changed the file.
    void loadSettings().then(() => {
      if (state.dialog.mode === 'json') set('dialog', 'raw', state.raw);
    });
  }

  return {
    state,
    preferences: prefs,
    categories: categoryList,
    visible,
    value,
    onSaved(listener: SavedListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    actions: {
      loadSettings,
      openSettings,
      closeSettings: () => set('dialog', 'open', false),
      setSettingsMode,
      setSettingsCategory: (category: string) => set('dialog', { category, query: '' }),
      setSettingsQuery: (query: string) => set('dialog', 'query', query),
      settingFocused: () => set('dialog', 'focus', ''),
      editSetting(key: string, next: SettingValue): void {
        batch(() => {
          set('edits', key, next);
          set('save', { status: 'unsaved' });
        });
      },
      setSetting,
      commitNumber,
      resetSetting(key: string): void {
        const fallback = state.defaults[key];
        if (fallback !== undefined) void setSetting(key, fallback);
      },
      saveSettings,
      setRawSettings(raw: string): void {
        batch(() => {
          set('dialog', { raw, rawNotice: '' });
          set('save', { status: 'unsaved' });
        });
      },
      discardRawSettings: () => set('dialog', { raw: state.raw, rawError: '', rawNotice: '' }),
      saveRawSettings,
      async copySettingsPath(): Promise<void> {
        if (!state.path) return;
        await navigator.clipboard.writeText(state.path);
        toast('success', 'Copied settings path to clipboard', 2000);
      },
    },
  };
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;
