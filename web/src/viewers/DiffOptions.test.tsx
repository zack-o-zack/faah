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

vi.mock('../lib/api.ts', () => ({ api: vi.fn(), apiPost: vi.fn(), apiPostJson: vi.fn() }));
const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount() {
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
    return createAppStore({ fetcher: async () => ({ lines: ['new'], total: 1, exact: true }) });
  });
  const editor = createRoot((dispose) => {
    disposers.push(dispose);
    return createEditorStore(app, { review: { request: async () => ({ files: [] }) } });
  });
  await app.actions.openDocument('file.go');
  const doc = required(app.activeDocument());
  app.actions.patchDocument(doc.path, {
    diffMode: 'split',
    diffRef: 'abc1234',
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
  expect(document.querySelector('.diff-unified')).not.toBeNull();
  expect(document.querySelector('.diff-split')).toBeNull();
});

test('editor and walkthrough options derive distinct switch ids and share settings', async () => {
  const editor = await mount();
  editor.actions.setReviewMode('review');
  fireEvent.click(required(document.getElementById('diff-options')));
  const first = screen.getByRole('switch', { name: 'Ignore whitespace' }).id;
  fireEvent.click(screen.getByRole('switch', { name: 'Ignore whitespace' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(required(document.getElementById('btn-walkthrough-options')));
  expect(screen.getByRole('switch', { name: 'Ignore whitespace' }).id).not.toBe(first);
  expect(
    screen.getByRole('switch', { name: 'Ignore whitespace' }).getAttribute('aria-checked'),
  ).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Unified' }));
  expect(document.querySelector('.diff-unified')).not.toBeNull();
});
