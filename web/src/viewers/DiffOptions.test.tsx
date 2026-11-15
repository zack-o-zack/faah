import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { createEditorStore } from '../editor/store.ts';
import { EditorProvider } from '../editor/context.tsx';
import { FileActions } from '../editor/FileActions.tsx';
import { ReviewTabs } from '../review/ReviewTabs.tsx';
import { DiffViewer } from './DiffViewer.tsx';
import { required } from '../lib/test-values.ts';
import { api, apiPostJson } from '../lib/api.ts';
import { createRoot } from 'solid-js';
import { record } from '../lib/decode.ts';
import { createDiffActions } from './diff-actions.ts';

vi.mock('../lib/api.ts', () => ({ api: vi.fn(), apiPost: vi.fn(), apiPostJson: vi.fn() }));
const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

async function mount(working = false) {
  vi.clearAllMocks();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => {},
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.mocked(api).mockResolvedValue({
    path: 'file.go',
    available: true,
    diff: '@@ -1 +1 @@\n-old\n+new\n',
    hunks: [
      {
        oldStart: 1,
        newStart: 1,
        rows: [
          { type: 'del', oldLine: 1, at: 1, text: 'old' },
          { type: 'add', newLine: 1, text: 'new' },
        ],
      },
    ],
  });
  vi.mocked(apiPostJson).mockResolvedValue({ ok: true });
  const app = createRoot((dispose) => {
    disposers.push(dispose);
    const saved: Record<string, unknown> = {};
    return createAppStore({
      fetcher: async () => ({ lines: ['new'], total: 1, exact: true }),
      settings: { post: async (_, body) => ({ settings: Object.assign(saved, record(body)) }) },
    });
  });
  const editor = createRoot((dispose) => {
    disposers.push(dispose);
    return createEditorStore(app, { review: { request: async () => ({ files: [] }) } });
  });
  await app.actions.openDocument('file.go');
  const doc = required(app.activeDocument());
  app.actions.patchDocument(doc.path, {
    diffMode: 'split',
    diffRef: working ? '' : 'abc1234',
    diffBase: 'abc1234',
    turnFiles: ['file.go'],
  });
  render(() => (
    <EditorProvider value={editor}>
      <FileActions />
      <DiffViewer />
      <ReviewTabs />
    </EditorProvider>
  ));
  await waitFor(() => expect(document.querySelector('.diff-split')).not.toBeNull());
  return editor;
}

test('editor gear replaces the layout toggle only in diff mode', async () => {
  const editor = await mount();
  expect(document.getElementById('diff-options')).not.toBeNull();
  expect(document.querySelector('[id="diff-' + 'layout"]')).toBeNull();
  editor.actions.setView(editor.active(), 'source');
  expect(document.getElementById('diff-options')).toBeNull();
});

test('editor layout choice updates shared settings and open diff rows', async () => {
  const editor = await mount();
  const write = vi.spyOn(editor.settings.actions, 'setSetting');
  fireEvent.click(required(document.getElementById('diff-options')));
  fireEvent.click(screen.getByRole('button', { name: 'Unified' }));
  expect(write).toHaveBeenCalledWith('diffEditor.renderSideBySide', false);
  await waitFor(() => expect(document.querySelector('.diff-unified')).not.toBeNull());
  expect(document.querySelector('.diff-split')).toBeNull();
});

test('editor and walkthrough options derive distinct switch ids and share settings', async () => {
  const editor = await mount();
  editor.actions.setReviewMode('review');
  fireEvent.click(required(document.getElementById('diff-options')));
  const first = screen.getByRole('switch', { name: 'Ignore whitespace' }).id;
  fireEvent.click(screen.getByRole('switch', { name: 'Ignore whitespace' }));
  fireEvent.click(required(document.getElementById('btn-walkthrough-options')));
  const switches = screen.getAllByRole('switch', { name: 'Ignore whitespace' });
  expect(switches).toHaveLength(2);
  expect(new Set(switches.map((input) => input.id)).size).toBe(2);
  expect(switches.map((input) => input.id)).toContain(first);
  for (const input of switches) {
    expect(input.getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
  }
  fireEvent.click(required(screen.getAllByRole('button', { name: 'Unified' }).at(-1)));
  await waitFor(() => expect(document.querySelector('.diff-unified')).not.toBeNull());
});

test('whitespace switch reloads the editor diff with an optional query parameter', async () => {
  await mount();
  const diffCalls = () => vi.mocked(api).mock.calls.filter(([path]) => path === 'api/diff');
  expect(diffCalls().at(-1)?.[1]).not.toHaveProperty('ignoreWhitespace');
  fireEvent.click(required(document.getElementById('diff-options')));
  fireEvent.click(screen.getByRole('switch', { name: 'Ignore whitespace' }));
  await waitFor(() => expect(diffCalls().at(-1)?.[1]).toHaveProperty('ignoreWhitespace', '1'));
  fireEvent.click(screen.getByRole('switch', { name: 'Ignore whitespace' }));
  await waitFor(() => expect(diffCalls()).toHaveLength(3));
  expect(diffCalls().at(-1)?.[1]).not.toHaveProperty('ignoreWhitespace');
});

test('an empty filtered diff stays open and explains whitespace-only changes', async () => {
  const editor = await mount();
  vi.mocked(api).mockResolvedValue({ path: 'file.go', diff: '', hunks: [], available: true });
  await editor.settings.actions.setSetting('diffEditor.ignoreWhitespace', true);
  await screen.findByText('Only whitespace changes');
  expect(screen.queryByText('No changes.')).toBeNull();
  expect(document.getElementById('diff-options')).not.toBeNull();
});

test.each(['Stage', 'Unstage', 'Discard', 'Expand'])(
  '%s cannot act on filtered rows',
  async (action) => {
    const editor = await mount(true);
    expect(screen.getByRole('button', { name: action })).toBeTruthy();
    await editor.settings.actions.setSetting('diffEditor.ignoreWhitespace', true);
    await waitFor(() => expect(screen.queryByRole('button', { name: action })).toBeNull());
    await editor.settings.actions.setSetting('diffEditor.ignoreWhitespace', false);
    await screen.findByRole('button', { name: action });
  },
);

test.each(['stage', 'unstage', 'discard', 'expand'] as const)(
  'a stale %s callback cannot submit a filtered hunk',
  async (action) => {
    const editor = await mount(true);
    const actions = createRoot((dispose) => {
      disposers.push(dispose);
      return createDiffActions(editor, () => required(editor.active()), vi.fn(), vi.fn());
    });
    await editor.settings.actions.setSetting('diffEditor.ignoreWhitespace', true);
    vi.mocked(api).mockClear();
    vi.mocked(apiPostJson).mockClear();
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    const hunk = { oldStart: 1, newStart: 1, rows: [] };
    if (action === 'expand') await actions.expand(hunk);
    else await actions.apply(hunk, action);
    expect(apiPostJson).not.toHaveBeenCalled();
    expect(api).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  },
);
