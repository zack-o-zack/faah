import { createStore } from 'solid-js/store';
import { afterEach, expect, test, vi } from 'vitest';
import { api } from '../lib/api.ts';
import { bootWorkspace, type BootEditor } from './boot.ts';
import type { WorkspaceMeta } from './types.ts';

vi.mock('../lib/api.ts', () => ({ api: vi.fn() }));
vi.mock('../lib/toast.jsx', () => ({ toast: vi.fn() }));

interface Tab {
  path: string;
  diffAvailable?: boolean;
}

interface State {
  workspace: { meta: WorkspaceMeta | null; error: string };
  documents: { tabs: Tab[] };
}
const isMeta = (value: unknown): value is WorkspaceMeta =>
  typeof value === 'object' && value !== null && 'root' in value;

function createEditor(tabs: Tab[] = [], gitView = true) {
  const initial: State = { workspace: { meta: null, error: '' }, documents: { tabs } };
  const [state, setState] = createStore(initial);
  const actions = {
    loadSettings: vi.fn(async () => {}),
    initializeThreads: vi.fn(async () => {}),
    initializeGit: vi.fn(async () => {}),
    acceptAgentMeta: vi.fn(),
    initializePR: vi.fn(),
    initializeAgents: vi.fn(async () => {}),
    setAutoRevealSuppressed: vi.fn(),
    refreshTree: vi.fn(async () => {}),
    refreshWorkspace: vi.fn(async () => {}),
    startWorkspaceStream: vi.fn(),
    refreshUnpushed: vi.fn(async () => {}),
    setTreeMode: vi.fn(async () => {}),
    expandTree: vi.fn(async () => {}),
    collapseTree: vi.fn(),
    revealFile: vi.fn(async () => {}),
    switchTab: vi.fn(),
    openFile: vi.fn(async () => {}),
    setReviewMode: vi.fn(),
  };
  const editor: BootEditor = {
    active: () => null,
    store: {
      state,
      actions: {
        setWorkspace: (meta) => setState('workspace', 'meta', isMeta(meta) ? meta : null),
        setWorkspaceError: (error) => setState('workspace', 'error', error),
      },
    },
    tree: { hasGitView: () => gitView, mode: () => (gitView ? 'git' : 'files') },
    actions,
  };
  return { editor, actions, state };
}

const meta = (fields: Partial<WorkspaceMeta> = {}): WorkspaceMeta => ({
  root: '/repo',
  name: 'repo',
  ready: true,
  ...fields,
});
const settle = () => vi.waitFor(() => {});

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState({}, '', '/');
});

test('a workspace with changes opens Git view on its first changed file', async () => {
  vi.mocked(api).mockResolvedValue(meta({ git: true, gitChanges: 2, gitFiles: ['a.go', 'b.go'] }));
  const { editor, actions } = createEditor();
  bootWorkspace(editor);
  await vi.waitFor(() => expect(actions.initializeAgents).toHaveBeenCalled());
  expect(actions.setTreeMode).toHaveBeenCalledWith('git', { expandDirty: true });
  expect(actions.openFile).toHaveBeenCalledWith('a.go');
  expect(actions.expandTree).toHaveBeenCalledWith(true);
  expect(actions.setAutoRevealSuppressed).toHaveBeenLastCalledWith(false);
  expect(actions.setReviewMode).not.toHaveBeenCalled();
});

test('an open changed tab is selected instead of opening a file', async () => {
  vi.mocked(api).mockResolvedValue(meta({ git: true, gitChanges: 1, gitFiles: ['a.go'] }));
  const { editor, actions } = createEditor([
    { path: 'x.go' },
    { path: 'a.go', diffAvailable: true },
  ]);
  bootWorkspace(editor);
  await vi.waitFor(() => expect(actions.initializeAgents).toHaveBeenCalled());
  expect(actions.switchTab).toHaveBeenCalledWith(1);
  expect(actions.openFile).not.toHaveBeenCalled();
});

test('a clean workspace collapses the file tree; a PR session opens the overview', async () => {
  vi.mocked(api).mockResolvedValue(meta({ pr: { number: 7 } }));
  const { editor, actions } = createEditor([], false);
  bootWorkspace(editor);
  await vi.waitFor(() => expect(actions.initializeAgents).toHaveBeenCalled());
  expect(actions.setTreeMode).toHaveBeenCalledWith('files', { expandDirty: false });
  expect(actions.collapseTree).toHaveBeenCalled();
  expect(actions.setReviewMode).toHaveBeenCalledWith('review');
});

test('a path and line in the address open that file and leave the address', async () => {
  window.history.replaceState({}, '', '/?path=main.go&line=12&keep=1');
  vi.mocked(api).mockResolvedValue(meta({ git: true, gitChanges: 1, gitFiles: ['a.go'] }));
  const { editor, actions } = createEditor();
  bootWorkspace(editor);
  await vi.waitFor(() => expect(actions.initializeAgents).toHaveBeenCalled());
  expect(actions.openFile).toHaveBeenCalledWith('main.go', { line: 12 });
  expect(actions.openFile).toHaveBeenCalledTimes(1);
  expect(window.location.search).toBe('?keep=1');
});

test('an unfinished index is polled until ready; stopping ends the poll', async () => {
  vi.useFakeTimers();
  vi.mocked(api)
    .mockResolvedValueOnce(meta({ ready: false }))
    .mockResolvedValueOnce(meta({ ready: false }))
    .mockResolvedValue(meta({ git: true, gitChanges: 1, gitFiles: ['a.go'], files: 10 }));
  const { editor, actions, state } = createEditor();
  const stop = bootWorkspace(editor);
  await vi.waitFor(() => expect(actions.initializeAgents).toHaveBeenCalled());
  expect(actions.openFile).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(150);
  expect(state.workspace.meta?.ready).toBe(false);
  await vi.advanceTimersByTimeAsync(150);
  await vi.waitFor(() => expect(actions.openFile).toHaveBeenCalledWith('a.go'));
  expect(state.workspace.meta?.files).toBe(10);
  expect(actions.refreshWorkspace).toHaveBeenCalled();
  const calls = vi.mocked(api).mock.calls.length;
  stop();
  await vi.advanceTimersByTimeAsync(600);
  expect(vi.mocked(api).mock.calls.length).toBe(calls);
});

test('a failed metadata request is reported on the workspace', async () => {
  vi.mocked(api).mockRejectedValue(new Error('server gone'));
  const { editor, state, actions } = createEditor();
  bootWorkspace(editor);
  await vi.waitFor(() => expect(state.workspace.error).toBe('server gone'));
  await settle();
  expect(actions.refreshTree).not.toHaveBeenCalled();
});
