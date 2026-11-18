import { prMeta } from '../pr/test-editor.ts';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { createEditorStore } from '../editor/store.ts';
import { EditorProvider } from '../editor/context.tsx';
import { FileActions } from '../editor/FileActions.tsx';
import { ReviewTabs } from '../review/ReviewTabs.tsx';
import { Walkthrough } from '../review/Walkthrough.tsx';
import { WalkthroughFile } from '../review/WalkthroughFile.tsx';
import { DiffViewer } from './DiffViewer.tsx';
import { required } from '../lib/test-values.ts';
import { api, apiPostJson } from '../lib/api.ts';
import { createRoot, Show } from 'solid-js';
import { record } from '../lib/decode.ts';
import { createDiffActions } from './diff-actions.ts';

vi.mock('../lib/api.ts', () => ({ api: vi.fn(), apiPost: vi.fn(), apiPostJson: vi.fn() }));
const disposers: (() => void)[] = [];
const reviewRequest = vi.fn(async () => ({ files: [] }));
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

async function mount(working = false, walkthrough = false) {
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
    return createEditorStore(app, { review: { request: reviewRequest } });
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
      <Walkthrough />
      <Show when={walkthrough}>
        <div data-testid="walkthrough-file">
          <WalkthroughFile
            file={{
              path: 'file.go',
              group: 'core',
              additions: 1,
              deletions: 1,
              hunks: [
                {
                  oldStart: 1,
                  newStart: 1,
                  rows: [
                    { type: 'del', oldLine: 1, text: 'old' },
                    { type: 'add', newLine: 1, text: 'new' },
                  ],
                },
              ],
            }}
          />
        </div>
      </Show>
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
  editor.store.actions.setWorkspace({ git: true, pr: prMeta() });
  editor.actions.setReviewMode('review');
  editor.actions.setReviewTab('walkthrough');
  await waitFor(() => expect(document.getElementById('btn-walkthrough-options')).not.toBeNull());
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

test('both changed-word switches have unique labels and write the shared setting', async () => {
  const editor = await mount();
  const write = vi.spyOn(editor.settings.actions, 'setSetting');
  editor.store.actions.setWorkspace({ git: true, pr: prMeta() });
  editor.actions.setReviewMode('review');
  editor.actions.setReviewTab('walkthrough');
  await waitFor(() => expect(document.getElementById('btn-walkthrough-options')).not.toBeNull());
  fireEvent.click(required(document.getElementById('diff-options')));
  fireEvent.click(required(document.getElementById('btn-walkthrough-options')));
  const switches = screen.getAllByRole('switch', { name: 'Highlight changed words' });
  expect(switches).toHaveLength(2);
  expect(new Set(switches.map((input) => input.id)).size).toBe(2);
  for (const input of switches) {
    expect(input.getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector(`label[for="${input.id}"]`)?.textContent).toBe(
      'Highlight changed words',
    );
    expect(input.parentElement?.textContent).toContain(
      'Marks the exact words that changed in a line',
    );
  }
  for (const [index, value] of [
    [0, false],
    [1, true],
  ] as const) {
    fireEvent.click(required(switches[index]));
    expect(write).toHaveBeenLastCalledWith('diffEditor.highlightChangedWords', value);
    await waitFor(() => {
      for (const input of switches) expect(input.getAttribute('aria-checked')).toBe(String(value));
    });
  }
});

test.each([true, false])(
  'changed-word toggle updates both rendered views without refetching (split=%s)',
  async (split) => {
    const editor = await mount(false, true);
    await editor.settings.actions.setSetting('diffEditor.renderSideBySide', split);
    const views = [
      required(document.getElementById('diffview')),
      screen.getByTestId('walkthrough-file'),
    ];
    const before = views.map((view) => view.innerHTML);
    for (const view of views) expect(view.querySelector('[class*="diff-char-"]')).not.toBeNull();
    const requests = vi.mocked(api).mock.calls.length;
    const posts = vi.mocked(apiPostJson).mock.calls.length;
    const reviewRequests = reviewRequest.mock.calls.length;
    fireEvent.click(required(document.getElementById('diff-options')));
    fireEvent.click(screen.getByRole('switch', { name: 'Highlight changed words' }));
    await waitFor(() => {
      for (const view of views) expect(view.querySelector('[class*="diff-char-"]')).toBeNull();
    });
    for (const view of views) {
      expect(view.querySelector('.diff-add, .diff-type-add')).not.toBeNull();
      expect(view.querySelector('.diff-del, .diff-type-del')).not.toBeNull();
      expect(view.querySelector('.diff-mk, .diff-col-sign')?.textContent).toMatch(/[-−]/);
      expect(view.querySelector('.diff-ln, .diff-col-num')?.textContent).toContain('1');
      expect([...view.querySelectorAll('.diff-code')].map((code) => code.textContent)).toEqual([
        'old',
        'new',
      ]);
    }
    fireEvent.click(screen.getByRole('switch', { name: 'Highlight changed words' }));
    await waitFor(() => expect(views.map((view) => view.innerHTML)).toEqual(before));
    expect(api).toHaveBeenCalledTimes(requests);
    expect(apiPostJson).toHaveBeenCalledTimes(posts);
    expect(reviewRequest).toHaveBeenCalledTimes(reviewRequests);
  },
);
