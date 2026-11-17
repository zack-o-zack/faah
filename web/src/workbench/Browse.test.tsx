import type { Request } from '../lib/api.ts';
import { fireEvent, render, screen, within } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { record } from '../lib/decode.ts';
import { required } from '../lib/test-values.ts';
import { Browse } from './Browse.tsx';
import { WorkbenchProvider } from './context.tsx';
import { createWorkbenchStore } from './store.ts';

const directory = {
  path: '/home/me/Projects/fibo/web/src',
  parent: '/home/me/Projects/fibo/web',
  entries: [
    { name: '.config', path: '/home/me/Projects/fibo/web/src/.config' },
    { name: 'agents', path: '/home/me/Projects/fibo/web/src/agents', git: true },
    { name: 'workbench', path: '/home/me/Projects/fibo/web/src/workbench' },
  ],
};
async function setup(
  preview: Request = async () => ({ entries: [{ name: 'fixtures', path: '/fixtures' }] }),
) {
  const request = vi.fn<Request>(async (url, params) => {
    if (url === 'api/wb/state') return { home: '/home/me' };
    return record(params).path === directory.path ? directory : preview(url, params);
  });
  const post = vi.fn<Request>(async () => ({ href: '/w/fibo/' }));
  const store = createWorkbenchStore(request, post, vi.fn());
  await store.actions.browse(directory.path);
  await store.actions.refresh();
  const view = render(() => (
    <WorkbenchProvider store={store}>
      <Browse />
    </WorkbenchProvider>
  ));
  return { ...store, request, post, ...view };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('toolbar has accessible icon buttons, selection-aware primary Open, and separated crumbs', async () => {
  const { actions, post } = await setup();
  actions.selectDirectory(-1);
  const up = screen.getByRole<HTMLButtonElement>('button', { name: 'Up one folder' });
  expect(up.disabled).toBe(false);
  expect(up.dataset.variant).toBe('ghost');
  expect(screen.getByRole('button', { name: 'New folder' })).toBeTruthy();
  const hidden = screen.getByRole('button', { name: 'Show hidden folders' });
  expect(hidden.getAttribute('aria-pressed')).toBe('false');
  expect(hidden.querySelector('.icon-\\[ph--eye-slash\\]')).toBeTruthy();
  const currentOpen = screen.getByRole('button', { name: 'Open src' });
  expect(currentOpen.dataset.variant).not.toBe('secondary');
  expect(currentOpen.querySelectorAll('kbd')).toHaveLength(2);
  const crumbs = screen.getByRole('navigation', { name: 'Folder path' });
  expect(
    within(crumbs)
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual(['~', 'Projects', 'fibo', 'web', 'src']);
  expect(crumbs.querySelectorAll('.icon-\\[ph--caret-right\\]')).toHaveLength(4);
  expect(within(crumbs).getByRole('button', { name: 'src' }).getAttribute('aria-current')).toBe(
    'location',
  );
  actions.selectDirectory(2);
  fireEvent.click(screen.getByRole('button', { name: 'Open workbench' }));
  expect(post).toHaveBeenCalledWith('api/wb/open', { target: directory.entries[2]?.path });
  actions.selectDirectory(-1);
  expect(screen.getByRole('button', { name: 'Open src' })).toBeTruthy();
});

test('Up is disabled at root and the Open target names the home folder', async () => {
  const { actions } = await setup(async (_url, params) => ({
    path: record(params).path,
    entries: [],
  }));
  await actions.browse('/');
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Up one folder' }).disabled).toBe(
    true,
  );
  expect(screen.getByRole('button', { name: 'Open /' })).toBeTruthy();
  await actions.browse('/home/me');
  expect(screen.getByRole('button', { name: 'Open me' })).toBeTruthy();
});

test('clone mode keeps Use wording for the selected target', async () => {
  const { actions, post } = await setup();
  post.mockResolvedValueOnce({ needClone: true, repo: 'org/fibo', managed: '/managed' });
  await actions.open('https://host/org/fibo/pull/1');
  actions.selectDirectory(-1);
  expect(screen.getByRole('button', { name: 'Use src' })).toBeTruthy();
  actions.selectDirectory(1);
  expect(screen.getByRole('button', { name: 'Use agents' })).toBeTruthy();
});

test('hidden toggle updates its icon and pressed state; folder creation opens the form', async () => {
  const { state } = await setup();
  const hidden = screen.getByRole('button', { name: 'Show hidden folders' });
  fireEvent.click(hidden);
  expect(state.hidden).toBe(true);
  expect(hidden.getAttribute('aria-pressed')).toBe('true');
  expect(hidden.querySelector('.icon-\\[ph--eye\\]')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
  expect(screen.getByRole('textbox', { name: 'New folder name or path' })).toBeTruthy();
});

test('folder rows use muted git icons and hidden names, with a trailing caret', async () => {
  await setup();
  const git = screen.getByRole('option', { name: 'agents' });
  const icon = required(git.querySelector('.icon-\\[ph--git-branch\\]'));
  expect(icon.classList.contains('text-muted-foreground')).toBe(true);
  expect(icon.classList.contains('text-gi')).toBe(false);
  expect(git.querySelector('.icon-\\[ph--caret-right\\]')).toBeTruthy();
  expect(
    screen.getByRole('option', { name: '.config' }).classList.contains('text-muted-foreground'),
  ).toBe(true);
});

test('normal folder names use foreground and hidden names stay muted in both panes', async () => {
  const { actions } = await setup(async () => ({
    entries: [
      { name: '.hidden', path: '/preview/.hidden' },
      { name: 'visible', path: '/preview/visible' },
    ],
  }));
  const hiddenRow = screen.getByRole('option', { name: '.config' });
  const visibleRow = screen.getByRole('option', { name: 'agents' });
  expect(hiddenRow.classList.contains('text-muted-foreground')).toBe(true);
  expect(hiddenRow.classList.contains('text-foreground')).toBe(false);
  expect(visibleRow.classList.contains('text-foreground')).toBe(true);
  expect(visibleRow.classList.contains('text-muted-foreground')).toBe(false);
  actions.selectDirectory(1);
  await vi.advanceTimersByTimeAsync(80);
  const pane = screen.getByRole('region', { name: 'Folder preview' });
  const hiddenPreview = within(pane).getByRole('button', { name: '.hidden' });
  const visiblePreview = within(pane).getByRole('button', { name: 'visible' });
  expect(hiddenPreview.classList.contains('text-muted-foreground')).toBe(true);
  expect(hiddenPreview.classList.contains('text-foreground')).toBe(false);
  expect(visiblePreview.classList.contains('text-foreground')).toBe(true);
  expect(visiblePreview.classList.contains('text-muted-foreground')).toBe(false);
});

test('preview renders unselected, loading, empty and error states', async () => {
  const preview = vi
    .fn<Request>()
    .mockResolvedValueOnce({ entries: [] })
    .mockRejectedValueOnce(new Error('Permission denied'));
  const { actions, state } = await setup(preview);
  const pane = screen.getByRole('region', { name: 'Folder preview' });
  actions.selectDirectory(-1);
  expect(within(pane).getByText('Select a folder to look inside')).toBeTruthy();
  actions.selectDirectory(0);
  expect(within(pane).getByText('Loading…')).toBeTruthy();
  expect(pane.getAttribute('aria-busy')).toBe('true');
  await vi.advanceTimersByTimeAsync(80);
  expect(within(pane).getByText('No folders inside')).toBeTruthy();
  actions.selectDirectory(1);
  await vi.advanceTimersByTimeAsync(80);
  expect(within(pane).getByText('Permission denied')).toBeTruthy();
  expect(pane.getAttribute('aria-busy')).toBe('false');
  expect(state.directory).toMatchObject(directory);
  expect(state.selected).toBe(1);
});

test('preview children enter directly and keep keyboard navigation on the folder list', async () => {
  const path = required(directory.entries[2]).path;
  const { actions, request, post, state } = await setup(async (_url, params) => ({
    path: record(params).path,
    parent: String(record(params).path).slice(0, String(record(params).path).lastIndexOf('/')),
    entries:
      record(params).path === path
        ? [{ name: 'fixtures', path: `${path}/fixtures` }]
        : [{ name: 'nested', path: `${path}/fixtures/nested` }],
  }));
  actions.selectDirectory(2);
  await vi.advanceTimersByTimeAsync(80);
  const pane = screen.getByRole('region', { name: 'Folder preview' });
  expect(within(pane).queryByRole('listbox')).toBeNull();
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await user.click(within(pane).getByRole('button', { name: 'fixtures' }));
  expect(request).toHaveBeenLastCalledWith('api/wb/browse', {
    path: `${path}/fixtures`,
    hidden: undefined,
  });
  expect(state.directory.path).toBe(`${path}/fixtures`);
  expect(state.selected).toBe(-1);
  expect(document.activeElement).toBe(screen.getByRole('listbox', { name: 'Folders' }));
  expect(screen.getByRole('option', { name: 'nested' }).getAttribute('aria-selected')).toBe(
    'false',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open fixtures' }));
  expect(post).toHaveBeenLastCalledWith('api/wb/open', { target: `${path}/fixtures` });
  await user.keyboard('{ArrowDown}');
  expect(screen.getByRole('button', { name: 'Open nested' })).toBeTruthy();
  await user.keyboard('{Control>}{Enter}{/Control}');
  expect(post).toHaveBeenLastCalledWith('api/wb/open', { target: `${path}/fixtures/nested` });
  await user.keyboard('{ArrowLeft}');
  expect(state.directory.path).toBe(path);
  expect(state.selected).toBe(0);
  expect(state.preview.path).toBe(`${path}/fixtures`);
});

test('single click selects without entering, focuses the list and loads children', async () => {
  const { state, request } = await setup();
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await user.click(screen.getByRole('option', { name: 'workbench' }));
  expect(state.directory.path).toBe(directory.path);
  expect(state.selected).toBe(2);
  expect(request).toHaveBeenCalledTimes(2);
  expect(document.activeElement).toBe(screen.getByRole('listbox', { name: 'Folders' }));
  expect(screen.getByRole('button', { name: 'Open workbench' })).toBeTruthy();
  await vi.advanceTimersByTimeAsync(80);
  const pane = screen.getByRole('region', { name: 'Folder preview' });
  expect(within(pane).getByRole('button', { name: 'fixtures' })).toBeTruthy();
  expect(request).toHaveBeenLastCalledWith('api/wb/browse', {
    path: directory.entries[2]?.path,
    hidden: undefined,
  });
});

test.each(['double click', 'caret', 'ArrowRight', 'Enter'])(
  '%s enters with no selected child and Left restores the previous selection',
  async (gesture) => {
    const path = required(directory.entries[2]).path;
    const { state, request } = await setup(async (_url, params) => ({
      path: record(params).path,
      parent: directory.path,
      entries: [{ name: 'child', path: `${String(record(params).path)}/child` }],
    }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const row = screen.getByRole('option', { name: 'workbench' });
    if (gesture === 'double click') await user.dblClick(row);
    else if (gesture === 'caret')
      await user.click(required(row.querySelector('.icon-\\[ph--caret-right\\]')));
    else {
      await user.click(row);
      await user.keyboard(`{${gesture}}`);
    }
    expect(state.directory.path).toBe(path);
    expect(state.selected).toBe(-1);
    expect(state.preview.path).toBe('');
    expect(
      screen.getByRole('listbox', { name: 'Folders' }).hasAttribute('aria-activedescendant'),
    ).toBe(false);
    expect(screen.getByRole('option', { name: 'child' }).getAttribute('aria-selected')).toBe(
      'false',
    );
    expect(screen.getByRole('button', { name: 'Open workbench' })).toBeTruthy();
    await vi.advanceTimersByTimeAsync(80);
    expect(
      within(screen.getByRole('region', { name: 'Folder preview' })).getByText(
        'Select a folder to look inside',
      ),
    ).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(3);
    await user.keyboard('{ArrowLeft}');
    expect(state.directory.path).toBe(directory.path);
    expect(state.selected).toBe(2);
    expect(state.preview.path).toBe(path);
  },
);

test('double-clicking a caret enters only one level when the first row is reused', async () => {
  const path = required(directory.entries[0]).path;
  const { state } = await setup(async (_url, params) => ({
    path: record(params).path,
    parent: String(record(params).path).slice(0, String(record(params).path).lastIndexOf('/')),
    entries: [{ name: 'child', path: `${String(record(params).path)}/child` }],
  }));
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const row = screen.getByRole('option', { name: '.config' });
  await user.dblClick(required(row.querySelector('.icon-\\[ph--caret-right\\]')));
  expect(state.directory.path).toBe(path);
});

test('footer renders the four shortcut hints with shared Kbd keycaps', async () => {
  const { container } = await setup();
  const footer = required(container.querySelector('footer'));
  for (const label of ['Move', 'Inside', 'Up', 'Open'])
    expect(within(footer).getByText(label)).toBeTruthy();
  expect(footer.querySelectorAll('[data-control="shortcut"]')).toHaveLength(4);
  expect(footer.querySelectorAll('kbd')).toHaveLength(6);
  expect(footer.textContent).toContain('↑');
  expect(footer.textContent).toContain('↓');
  expect(footer.textContent).toContain('→');
  expect(footer.textContent).toContain('←');
});

test('keyboard selection, typeahead, deselection, opening and navigation stay intact', async () => {
  const { state, post, request } = await setup();
  const list = screen.getByRole('listbox', { name: 'Folders' });
  expect(state.selected).toBe(-1);
  fireEvent.keyDown(list, { key: 'ArrowDown' });
  expect(state.selected).toBe(0);
  fireEvent.keyDown(list, { key: 'ArrowDown' });
  expect(state.selected).toBe(1);
  fireEvent.keyDown(list, { key: 'ArrowUp' });
  expect(state.selected).toBe(0);
  fireEvent.keyDown(list, { key: 'w' });
  expect(state.selected).toBe(2);
  expect(list.getAttribute('aria-activedescendant')).toBe('folder-2');
  fireEvent.keyDown(list, { key: 'Enter', ctrlKey: true });
  expect(post).toHaveBeenLastCalledWith('api/wb/open', { target: directory.entries[2]?.path });
  fireEvent.keyDown(list, { key: 'Enter', metaKey: true });
  expect(post).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(list, { key: 'Escape' });
  expect(state.selected).toBe(-1);
  expect(list.hasAttribute('aria-activedescendant')).toBe(false);
  fireEvent.keyDown(list, { key: 'w' });
  fireEvent.keyDown(list, { key: 'ArrowRight' });
  expect(request).toHaveBeenLastCalledWith('api/wb/browse', {
    path: directory.entries[2]?.path,
    hidden: undefined,
  });
  fireEvent.keyDown(list, { key: 'ArrowLeft' });
  expect(request).toHaveBeenLastCalledWith('api/wb/browse', {
    path: directory.parent,
    hidden: undefined,
  });
  fireEvent.keyDown(list, { key: 'Backspace' });
  expect(request).toHaveBeenLastCalledWith('api/wb/browse', {
    path: directory.parent,
    hidden: undefined,
  });
});
