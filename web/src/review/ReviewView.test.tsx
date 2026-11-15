import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { EditorProvider } from '../editor/context.tsx';
import { createEditorStore } from '../editor/store.ts';
import type { EditorStore } from '../editor/store.ts';
import { required } from '../lib/test-values.ts';
import { ReviewView } from './ReviewView.tsx';

function mount(reply: unknown, walkthrough: unknown = { files: [], totalFiles: 0 }) {
  let editor: EditorStore | undefined;
  render(() => {
    const app = createAppStore();
    app.actions.subscribeWorkspaceEvent = () => () => {};
    app.actions.setWorkspaceTopic = vi.fn();
    app.actions.watchWorkspaceThread = () => () => {};
    const request = vi.fn(async (path: string) =>
      path.includes('walkthrough') ? walkthrough : reply,
    );
    editor = createEditorStore(app, { review: { request } });
    return (
      <EditorProvider value={editor}>
        <ReviewView />
      </EditorProvider>
    );
  });
  return required(editor);
}

test('the review mounts only in review mode and toggles its layout', async () => {
  const editor = mount({ config: { stages: [{ id: 'a', title: 'Check changes' }] } });
  expect(document.getElementById('review-view')).toBe(null);
  editor.actions.setReviewMode('review');
  await screen.findByText('Working tree is clean');
  editor.actions.setReviewTab('stages');
  const view = required(document.getElementById('review-view'));
  expect(view.classList.contains('layout-vertical')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Toggle layout' }));
  expect(view.classList.contains('layout-horizontal')).toBe(true);
});

test('a pending stage offers a run button and hides an empty question', async () => {
  const editor = mount({ config: { stages: [{ id: 'a', title: 'Check changes', question: '' }] } });
  editor.actions.setReviewMode('review');
  editor.actions.setReviewTab('stages');
  await waitFor(() =>
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Check changes'),
  );
  expect(screen.getByRole('button', { name: 'Run this stage' })).toBeTruthy();
  expect(document.getElementById('review-question-text')).toBe(null);
  fireEvent.click(screen.getByRole('button', { name: 'Edit this stage' }));
  expect(screen.getByRole('form', { name: 'Edit stage' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('form')).toBe(null);
});

test('a configured stage shows its title and question before its first run', async () => {
  const editor = mount({
    config: { stages: [{ id: 'a', title: 'Configured stage', question: 'What changed?' }] },
  });
  editor.actions.setReviewMode('review');
  editor.actions.setReviewTab('stages');
  await waitFor(() =>
    expect(required(document.getElementById('review-question-text'))?.textContent).toBe(
      'What changed?',
    ),
  );
  expect(required(document.getElementById('review-stage-title')).textContent).toBe(
    'Configured stage',
  );
});

test('walkthrough filters list files by group', async () => {
  const editor = mount(
    { config: { stages: [] } },
    {
      totalFiles: 2,
      files: [
        {
          path: 'src/a.go',
          additions: 2,
          group: 'tests',
          oldPath: 'old/a.go',
          hunks: [],
        },
        { path: 'src/b.go', deletions: 1, group: 'core', hunks: [] },
      ],
    },
  );
  editor.actions.setReviewMode('review');
  await waitFor(() => expect(screen.getAllByTitle('src/b.go')).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: /Tests/ }));
  expect(screen.queryByTitle('src/b.go')).toBe(null);
  expect(document.getElementById('review-diff-pane')?.textContent).not.toContain('src/b.go');
  expect(screen.getByText('Moved from old/a.go, no content changes')).toBeTruthy();
});

test('review preserves server syntax tokens and decodes source text safely', async () => {
  const editor = mount(
    { config: { stages: [] } },
    {
      totalFiles: 1,
      files: [
        {
          path: 'main.go',
          group: 'core',
          additions: 1,
          hunks: [
            {
              oldStart: 1,
              newStart: 1,
              rows: [
                {
                  type: 'add',
                  newLine: 1,
                  text: 'func main() { x < 2 }',
                  html: '<i class=k>func</i> <i class=nf>main</i>() { x &lt; <i class=m>2</i> }',
                },
              ],
            },
          ],
        },
      ],
    },
  );
  editor.actions.setReviewMode('review');
  await screen.findByText('func');
  expect(document.querySelector('.diff-col-code .k')?.textContent).toBe('func');
  expect(document.querySelector('.diff-col-code .nf')?.textContent).toBe('main');
  expect(document.querySelector('.diff-type-add .diff-col-code')?.textContent).toBe(
    'func main() { x < 2 }',
  );
});

test('a changed binary move keeps its origin without a pure move badge', async () => {
  const editor = mount(
    { config: { stages: [] } },
    {
      totalFiles: 1,
      files: [
        {
          path: 'new.bin',
          oldPath: 'old.bin',
          group: 'core',
          diff: 'Binary files a/old.bin and b/new.bin differ',
          hunks: [],
        },
      ],
    },
  );
  editor.actions.setReviewMode('review');
  await screen.findByTitle('new.bin');
  expect(screen.getAllByTitle('old.bin')).toHaveLength(2);
  expect(screen.queryByText('Moved')).toBe(null);
  expect(screen.queryByText('Moved from old.bin, no content changes')).toBe(null);
  expect(screen.getByText('No diff hunks to display.')).toBeTruthy();
});

test('walkthrough follows the shared split and unified preference', async () => {
  const editor = mount(
    {},
    {
      files: [
        {
          path: 'main.go',
          group: 'core',
          hunks: [
            {
              oldStart: 1,
              newStart: 1,
              rows: [
                { type: 'del', oldLine: 1, text: 'old value' },
                { type: 'add', newLine: 1, text: 'new value' },
              ],
            },
          ],
        },
      ],
    },
  );
  editor.actions.setReviewMode('review');
  await screen.findByTitle('main.go');
  expect(document.querySelectorAll('.review-diff-table .diff-row-pair')).toHaveLength(1);
  void editor.store.settings.actions.setSetting('diffEditor.renderSideBySide', false);
  expect(document.querySelectorAll('.review-diff-table .diff-row-pair')).toHaveLength(0);
  expect(document.querySelectorAll('.review-diff-row')).toHaveLength(2);
});

test('diff options read and write shared settings and stay open', async () => {
  const editor = mount({});
  editor.actions.setReviewMode('review');
  await screen.findByText('Working tree is clean');
  const write = vi.spyOn(editor.store.settings.actions, 'setSetting');
  fireEvent.click(screen.getByRole('button', { name: 'Diff options' }));
  expect(screen.getByRole('button', { name: 'Side by side' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Unified' }));
  expect(write).toHaveBeenCalledWith('diffEditor.renderSideBySide', false);
  expect(screen.getByRole('button', { name: 'Unified' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('switch', { name: 'Ignore whitespace' }));
  expect(write).toHaveBeenCalledWith('diffEditor.ignoreWhitespace', true);
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Diff options' })).toBe(null);
  fireEvent.click(screen.getByRole('button', { name: 'Diff options' }));
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('dialog', { name: 'Diff options' })).toBe(null);
});

test.each([0, 2])(
  'hidden whitespace count %s appears only when positive, even with no visible files',
  async (count) => {
    const editor = mount({}, { files: [], hiddenWhitespaceFiles: count });
    editor.actions.setReviewMode('review');
    await waitFor(() => expect(editor.review.walkthroughData()).toBeTruthy());
    expect(screen.queryByText(count + ' whitespace-only files hidden') !== null).toBe(count > 0);
  },
);
