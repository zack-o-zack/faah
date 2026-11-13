import { vi } from 'vitest';
import { createStore } from 'solid-js/store';
import { createAppStore } from '../app/store.js';
import { createPRStore } from './store.js';
import { createMergeStore } from './merge-store.js';
import { createForgeStore } from './forge-store.js';

export const prMeta = (fields = {}) => ({
  number: 7,
  title: 'Fix the parser',
  url: 'https://github.com/o/r/pull/7',
  base: 'main',
  head: 'fix',
  state: 'open',
  writeAccess: true,
  files: ['a.go'],
  ...fields,
});

/** A real app store and the three PR slices, with the rest of the editor stubbed. Call inside a root. */
export function createPREditor({ meta = prMeta(), forge = null, request, post } = {}) {
  const app = createAppStore();
  app.actions.setWorkspace({ name: 'repo', pr: meta, forge });
  const [git] = createStore({ pending: '', sync: { inProgress: '', rewritten: false } });
  const [agents] = createStore({ harnesses: [], selected: '' });
  const editor = {
    store: app,
    git: { state: git },
    agents: { state: agents },
    active: () => null,
    actions: {
      openSettings: vi.fn(),
      refreshTree: vi.fn(async () => {}),
      setSelection: vi.fn(),
      setReviewMode: vi.fn(),
      openFile: vi.fn(async () => {}),
      centerLine: vi.fn(),
      reloadWorkspace: vi.fn(async () => {}),
      runAgentJob: vi.fn(async () => ({})),
      resolvePRBase: vi.fn(async () => {}),
      confirmForcePush: vi.fn(),
    },
  };
  const options = { request, post };
  editor.pr = createPRStore(editor, options);
  editor.merge = createMergeStore(editor, options);
  editor.forge = createForgeStore(editor, options);
  Object.assign(editor.actions, editor.pr.actions, editor.merge.actions, editor.forge.actions);
  return editor;
}

/** Answers GET/POST by path; a function value receives the params or body. */
export function routes(table) {
  return vi.fn(async (path, value) => {
    const key = Object.keys(table).find((prefix) => path.startsWith(prefix));
    if (!key) throw new Error('unexpected ' + path);
    const reply = table[key];
    return typeof reply === 'function' ? reply(value, path) : structuredClone(reply);
  });
}
