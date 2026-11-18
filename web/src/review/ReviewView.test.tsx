import { prMeta } from '../pr/test-editor.ts';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { EditorProvider } from '../editor/context.tsx';
import { createEditorStore } from '../editor/store.ts';
import type { EditorStore } from '../editor/store.ts';
import { required } from '../lib/test-values.ts';
import { decodeThread, type Thread } from '../threads/decode.ts';
import { ReviewView } from './ReviewView.tsx';

function mount(reply: unknown, walkthrough: unknown = { files: [], totalFiles: 0 }) {
  let editor: EditorStore | undefined;
  render(() => {
    const app = createAppStore();
    app.actions.setWorkspace({ git: true, pr: prMeta() });
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
  editor.actions.setReviewTab('walkthrough');
  await screen.findByText('No changes in this pull request');
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

test('stage loading and thinking use rotating starbursts instead of spirals', async () => {
  const def = { id: 'a', title: 'Check changes' };
  const editor = mount({
    config: { stages: [def] },
    run: {
      id: 'run',
      status: 'running',
      activeStage: 0,
      stages: [{ def, status: 'running', threadId: 'stage' }],
    },
  });
  let finish: ((thread: Thread) => void) | undefined;
  const pending = new Promise<Thread>((resolve) => {
    finish = resolve;
  });
  vi.spyOn(editor.threads.actions, 'loadThread').mockReturnValue(pending);
  editor.actions.setReviewMode('review');
  editor.actions.setReviewTab('stages');
  const loading = await screen.findByText('Loading the answer…');
  expect(
    required(loading.querySelector('.icon-\\[ph--spinner\\]')).classList.contains(
      'motion-safe:animate-spin',
    ),
  ).toBe(true);
  expect(document.querySelector('#review-stage-main .fibo-spiral')).toBeNull();
  const thread = decodeThread({ id: 'stage', turns: [{ id: 1, running: true }] });
  editor.actions.acceptThread(thread);
  finish?.(thread);
  const thinking = await screen.findByText('Reading the changes…');
  expect(
    required(thinking.querySelector('.icon-\\[ph--spinner\\]')).classList.contains(
      'motion-safe:animate-spin',
    ),
  ).toBe(true);
  expect(document.querySelector('#review-stage-main .fibo-spiral')).toBeNull();
  editor.actions.acceptThread(decodeThread({ id: 'stage', turns: [{ id: 1, reply: 'Done.' }] }));
  expect(screen.queryByText('Reading the changes…')).toBeNull();
});

test('walkthrough loading uses a rotating starburst at the global icon size', async () => {
  let finish: ((value: unknown) => void) | undefined;
  const pending = new Promise<unknown>((resolve) => {
    finish = resolve;
  });
  const editor = mount({}, pending);
  editor.actions.setReviewMode('review');
  editor.actions.setReviewTab('walkthrough');
  await screen.findByText('Loading changed files…');
  const view = required(document.getElementById('review-walkthrough-view'));
  const icon = required(view.querySelector('.icon-\\[ph--spinner\\]'));
  expect(icon.classList.contains('motion-safe:animate-spin')).toBe(true);
  expect(icon.className).not.toMatch(/\bsize-/);
  expect(view.querySelector('.fibo-spiral')).toBeNull();
  finish?.({ files: [], totalFiles: 0 });
  await screen.findByText('No changes in this pull request');
  expect(view.querySelector('.motion-safe\\:animate-spin')).toBeNull();
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
  editor.actions.setReviewTab('walkthrough');
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
  editor.actions.setReviewTab('walkthrough');
  await screen.findByText('func');
  expect(document.querySelector('.diff-code .k')?.textContent).toBe('func');
  expect(document.querySelector('.diff-code .nf')?.textContent).toBe('main');
  expect(document.querySelector('.diff-type-add .diff-code')?.textContent).toBe(
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
  editor.actions.setReviewTab('walkthrough');
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
  editor.actions.setReviewTab('walkthrough');
  await screen.findByTitle('main.go');
  expect(document.querySelectorAll('.review-diff-table .diff-row-pair')).toHaveLength(1);
  void editor.store.settings.actions.setSetting('diffEditor.renderSideBySide', false);
  expect(document.querySelectorAll('.review-diff-table .diff-row-pair')).toHaveLength(0);
  expect(document.querySelectorAll('.review-diff-row')).toHaveLength(2);
});

test('diff options read and write shared settings and stay open', async () => {
  const editor = mount({});
  editor.actions.setReviewMode('review');
  editor.actions.setReviewTab('walkthrough');
  await screen.findByText('No changes in this pull request');
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
  expect(
    screen.getByRole('switch', { name: 'Ignore whitespace' }).getAttribute('aria-checked'),
  ).toBe('true');
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
    editor.actions.setReviewTab('walkthrough');
    await waitFor(() => expect(editor.review.walkthroughData()).toBeTruthy());
    expect(screen.queryByText(count + ' whitespace-only files hidden') !== null).toBe(count > 0);
  },
);

test('review tabs use the line variant, meaningful icons and count pills', async () => {
  const editor = mount(
    { config: { stages: [] } },
    { totalFiles: 2, files: [{ path: 'src/b.go', group: 'core', hunks: [] }] },
  );
  editor.actions.setReviewMode('review');
  editor.actions.setReviewTab('walkthrough');
  await waitFor(() => expect(editor.review.walkthroughData()).toBeTruthy());
  const tablist = required(document.querySelector('#review-sub-bar [role="tablist"]'));
  expect(tablist.getAttribute('data-variant')).toBe('line');
  const icon = (id: string) =>
    required(document.getElementById(`btn-review-tab-${id}`)).querySelector('[aria-hidden="true"]');
  expect(icon('overview')?.className).toContain('icon-[ph--squares-four]');
  expect(icon('walkthrough')?.className).toContain('icon-[ph--git-diff]');
  expect(icon('stages')?.className).toContain('icon-[ph--list-checks]');
  const info = required(document.querySelector('#btn-review-tab-walkthrough [data-tab-info]'));
  const pill = required(info.lastElementChild);
  expect(pill.textContent).toBe('2');
  expect(pill.classList.contains('bg-(--hover)')).toBe(true);
  expect(pill.classList.contains('rounded-full')).toBe(true);
});

test('the file-group filters live in the changed files view beside the diff options', async () => {
  const editor = mount(
    { config: { stages: [] } },
    {
      totalFiles: 2,
      files: [
        { path: 'src/a.go', group: 'tests', hunks: [] },
        { path: 'src/b.go', group: 'core', hunks: [] },
      ],
    },
  );
  editor.actions.setReviewMode('review');
  editor.actions.setReviewTab('walkthrough');
  const filters = await screen.findByRole('group', { name: 'Filter file groups' });
  const view = required(document.getElementById('review-walkthrough-view'));
  expect(required(document.getElementById('review-sub-bar')).contains(filters)).toBe(false);
  expect(view.contains(filters)).toBe(true);
  expect(view.contains(required(document.getElementById('btn-walkthrough-options')))).toBe(true);
  const all = screen.getByRole('button', { name: /All/ });
  const tests = screen.getByRole('button', { name: /Tests/ });
  expect(all.getAttribute('aria-pressed')).toBe('true');
  expect(tests.getAttribute('aria-pressed')).toBe('false');
  expect(all.hasAttribute('data-variant')).toBe(false);
  expect(tests.hasAttribute('data-variant')).toBe(false);
  expect(tests.className).toContain('aria-pressed:bg-(--hover)');
  fireEvent.click(tests);
  expect(tests.getAttribute('aria-pressed')).toBe('true');
  expect(all.getAttribute('aria-pressed')).toBe('false');
  expect(screen.queryByTitle('src/b.go')).toBe(null);
});

test('the filter row stays hidden while the walkthrough loads', async () => {
  let finish: ((value: unknown) => void) | undefined;
  const pending = new Promise<unknown>((resolve) => {
    finish = resolve;
  });
  const editor = mount({ config: { stages: [] } }, pending);
  editor.actions.setReviewMode('review');
  editor.actions.setReviewTab('walkthrough');
  await screen.findByText('Loading changed files…');
  expect(screen.queryByRole('group', { name: 'Filter file groups' })).toBe(null);
  expect(document.getElementById('btn-walkthrough-options')).toBe(null);
  finish?.({ files: [], totalFiles: 0 });
  await screen.findByText('No changes in this pull request');
  expect(screen.getByRole('group', { name: 'Filter file groups' })).toBeTruthy();
});
