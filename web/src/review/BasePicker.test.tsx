import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { EditorProvider } from '../editor/context.tsx';
import { createEditorStore, type EditorStore } from '../editor/store.ts';
import { required } from '../lib/test-values.ts';
import { prMeta } from '../pr/test-editor.ts';
import { Palette } from '../palette/Palette.tsx';
import { WalkthroughFiles } from './WalkthroughFiles.tsx';
import { baseSuggestions, fileCount } from './logic.ts';
import type { ReviewBases } from './types.ts';

const bases: ReviewBases = {
  current: 'feature',
  defaultRemote: 'origin/main',
  upstream: 'origin/feature',
  branches: [
    { name: 'feature', remote: false },
    { name: 'main', remote: false },
    { name: 'origin/feature', remote: true },
    { name: 'origin/main', remote: true },
  ],
};
const data = {
  files: [],
  totalFiles: 0,
  totalAdditions: 0,
  totalDeletions: 0,
  hiddenWhitespaceFiles: 0,
  baseRef: 'HEAD',
  headRef: 'working-tree',
  prMode: false,
};
function mount(git = true, pr = false) {
  let editor: EditorStore | undefined;
  const request = vi.fn(async (path: string) => {
    if (path === 'api/review/bases') return bases;
    if (path.includes('base=missing'))
      throw Object.assign(new Error('Unknown comparison branch'), { status: 400 });
    return { ...data, baseRef: path.includes('base=') ? 'origin/main' : 'HEAD' };
  });
  render(() => {
    const app = createAppStore();
    app.actions.setWorkspace({ git, pr: pr ? prMeta() : undefined });
    app.actions.subscribeWorkspaceEvent = () => () => {};
    app.actions.setWorkspaceTopic = vi.fn();
    editor = createEditorStore(app, { review: { request } });
    editor.review.actions.setReviewMode('review');
    return (
      <EditorProvider value={editor}>
        <WalkthroughFiles data={editor.review.walkthroughData()} />
        <Palette />
      </EditorProvider>
    );
  });
  return { editor: required(editor), request };
}

test('suggestions omit unavailable and duplicate upstream values; counts use singular', () => {
  expect(
    baseSuggestions({ ...bases, defaultRemote: '', upstream: '' }).map((row) => row.value),
  ).toEqual(['HEAD']);
  expect(baseSuggestions({ ...bases, upstream: 'origin/main' }).map((row) => row.value)).toEqual([
    'origin/main',
    'HEAD',
  ]);
  expect(fileCount(1)).toBe('1 file');
  expect(fileCount(2)).toBe('2 files');
});

test('picker loads lazily, searches with Solid, selects with keyboard and reloads', async () => {
  const { editor, request } = mount();
  await waitFor(() => expect(editor.review.walkthrough.loading).toBe(false));
  expect(request.mock.calls.some(([path]) => path.includes('/bases'))).toBe(false);
  fireEvent.click(
    screen.getByRole('button', { name: 'Change what the working tree is compared with' }),
  );
  const input = await screen.findByRole('searchbox');
  await waitFor(() => expect(document.activeElement).toBe(input));
  expect(screen.getByText('Remote default branch')).toBeTruthy();
  expect(screen.getByText('Remote branch (current)')).toBeTruthy();
  expect(screen.queryByRole('menuitem', { name: 'feature' })).toBeNull();
  expect(document.querySelector('[data-filter="HEAD"]')?.getAttribute('data-checked')).toBe('true');
  fireEvent.input(input, { target: { value: 'does-not-exist' } });
  expect(document.querySelector('[aria-label="Branches"]')?.getAttribute('data-empty')).toBe(
    'No matching branches',
  );
  expect(screen.queryAllByRole('menuitem').length).toBe(3);
  fireEvent.input(input, { target: { value: 'MAIN' } });
  expect(
    screen.getAllByRole('menuitem').filter((row) => row.textContent === 'origin/feature'),
  ).toHaveLength(0);
  // Suggestions remain visible above the search results. End selects the final matching branch.
  fireEvent.keyDown(input, { key: 'End' });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(editor.review.walkthroughData()?.baseRef).toBe('origin/main'));
  expect(
    request.mock.calls.some(([path]) => path === 'api/review/walkthrough?base=origin%2Fmain'),
  ).toBe(true);
  expect(screen.queryByRole('searchbox')).toBeNull();
  expect(document.getElementById('btn-walkthrough-base')?.textContent).toContain('origin/main');
});

test.each([
  [false, false],
  [true, true],
])('label stays plain with git=%s and PR=%s', async (git, pr) => {
  mount(git, pr);
  await waitFor(() => expect(document.querySelector('.font-mono')?.textContent).toContain('HEAD'));
  expect(document.getElementById('btn-walkthrough-base')).toBeNull();
});

test('a removed base falls back to HEAD and PR ignores the stored selection', async () => {
  const { editor, request } = mount();
  editor.review.actions.setComparisonBase('missing');
  await waitFor(() => expect(editor.review.state.base).toBe('HEAD'));
  await waitFor(() => expect(editor.review.walkthroughData()?.baseRef).toBe('HEAD'));
  editor.review.actions.setComparisonBase('origin/main');
  await waitFor(() => expect(editor.review.walkthroughData()?.baseRef).toBe('origin/main'));
  request.mockClear();
  editor.store.actions.setWorkspace({ git: true, pr: prMeta() });
  await waitFor(() =>
    expect(request.mock.calls.some(([path]) => path === 'api/review/walkthrough')).toBe(true),
  );
  expect(editor.review.state.base).toBe('origin/main');
});

test('search renders only matching branches and always keeps the suggestions', async () => {
  mount();
  fireEvent.click(
    screen.getByRole('button', { name: 'Change what the working tree is compared with' }),
  );
  const input = await screen.findByRole('searchbox');
  fireEvent.input(input, { target: { value: 'MAIN' } });
  const branches = screen.getByRole('menu', { name: 'Branches' });
  expect(
    Array.from(branches.querySelectorAll('[role="menuitem"]')).map((row) => row.textContent),
  ).toEqual(['main', 'origin/main']);
  expect(
    screen.getByRole('group', { name: 'Suggestions' }).querySelectorAll('[role="menuitem"]'),
  ).toHaveLength(3);
  fireEvent.input(input, { target: { value: 'missing' } });
  expect(branches.querySelectorAll('[role="menuitem"]')).toHaveLength(0);
  expect(screen.getByText('No matching branches')).toBeTruthy();
});

test('arrow keys and Enter select the active row and Escape restores trigger focus', async () => {
  const { editor } = mount();
  const trigger = screen.getByRole('button', {
    name: 'Change what the working tree is compared with',
  });
  fireEvent.click(trigger);
  const input = await screen.findByRole('searchbox');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  const active = document.getElementById(input.getAttribute('aria-activedescendant') || '');
  expect(active?.textContent).toContain('Remote branch (current)');
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(editor.review.state.base).toBe('origin/feature'));
  expect(screen.queryByRole('searchbox')).toBeNull();
  fireEvent.click(trigger);
  fireEvent.keyDown(await screen.findByRole('searchbox'), { key: 'Escape' });
  expect(screen.queryByRole('searchbox')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

test('palette still filters and moves once after the picker has opened', async () => {
  const { editor } = mount();
  // In the browser the runtime starts its mutation observer at DOMContentLoaded.
  document.dispatchEvent(new Event('DOMContentLoaded'));
  fireEvent.click(
    screen.getByRole('button', { name: 'Change what the working tree is compared with' }),
  );
  const search = await screen.findByRole('searchbox');
  fireEvent.keyDown(search, { key: 'Escape' });
  editor.palette.commands.register([
    { name: 'Navigation first', run: vi.fn() },
    { name: 'Navigation second', run: vi.fn() },
    { name: 'Settings', run: vi.fn() },
  ]);
  await editor.actions.openPalette('command');
  const input = await screen.findByRole('textbox', { name: 'Search commands and files' });
  await waitFor(() => expect(editor.palette.items().length).toBeGreaterThanOrEqual(3));
  expect(document.querySelector('#palette')?.hasAttribute('data-command-initialized')).toBe(false);
  fireEvent.input(input, { target: { value: '>Navigation' } });
  await waitFor(() => expect(editor.palette.items()).toHaveLength(2));
  expect(screen.getAllByRole('menuitem').map((row) => row.textContent)).toEqual([
    'Navigation first',
    'Navigation second',
  ]);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(editor.palette.state.selected).toBe(1);
  expect(document.querySelectorAll('#palette .active')).toHaveLength(1);
  expect(document.querySelector('#palette .active')?.textContent).toBe('Navigation second');
});
