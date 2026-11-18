import { render, screen, within } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { required } from '../lib/test-values.ts';
import type { RecentItem } from './decode.ts';
import { WorkbenchProvider } from './context.tsx';
import { Recent } from './Recent.tsx';
import { createWorkbenchStore } from './store.ts';

const folder: RecentItem = {
  id: 'folder',
  kind: 'dir',
  title: 'project',
  path: '/home/me/code/project',
  href: '/w/folder/',
  state: 'stopped',
};
const pr: RecentItem = {
  id: 'pr',
  kind: 'pr',
  title: 'Improve review navigation',
  repo: 'team/project',
  number: 37,
  path: '',
  href: '/w/pr/',
  state: 'stopped',
};

async function showRecent(items: RecentItem[]) {
  const request = vi.fn(async (path: string) =>
    path === 'api/wb/state'
      ? { items, home: '/home/me', sep: '/', cwd: '/home/me/code' }
      : { path: '/home/me/code', entries: [] },
  );
  const post = vi.fn(async () => ({ ok: true }));
  let store: ReturnType<typeof createWorkbenchStore> | undefined;
  const view = render(() => {
    const mounted = createWorkbenchStore(request, post);
    store = mounted;
    return (
      <WorkbenchProvider store={mounted}>
        <Recent />
      </WorkbenchProvider>
    );
  });
  const mounted = required(store);
  await mounted.actions.refresh();
  return { ...view, store: mounted, post };
}

test('sections show counts in order with kind icons, a PR chip and the parent folder', async () => {
  await showRecent([folder, pr, { ...folder, id: 'other', title: 'other' }]);
  expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
    'Pull requests 1',
    'Folders 2',
  ]);
  const prs = screen.getByRole('region', { name: 'Pull requests 1' });
  const folders = screen.getByRole('region', { name: 'Folders 2' });
  expect(within(prs).getAllByRole('listitem')).toHaveLength(1);
  expect(within(folders).getAllByRole('listitem')).toHaveLength(2);
  expect(prs.querySelector('[class~="icon-[ph--git-pull-request]"]')).toBeTruthy();
  expect(folders.querySelectorAll('[class~="icon-[ph--folder]"]')).toHaveLength(2);
  const chip = within(prs).getByText('#37');
  expect(chip.classList.contains('font-mono')).toBe(true);
  expect(within(prs).getByText('team/project')).toBeTruthy();
  expect(within(folders).getAllByText('~/code')).toHaveLength(2);
  expect(screen.queryByText('~/code/project')).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Pinned' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Recent' })).toBeNull();
});

test.each([
  { items: [folder], visible: 'Folders 1', hidden: /Pull requests/ },
  { items: [pr], visible: 'Pull requests 1', hidden: /Folders/ },
])('hides an empty section beside $visible', async ({ items, visible, hidden }) => {
  await showRecent(items);
  expect(screen.getByRole('region', { name: visible })).toBeTruthy();
  expect(screen.queryByRole('region', { name: hidden })).toBeNull();
});

test('an empty list keeps its existing empty state', async () => {
  await showRecent([]);
  expect(screen.queryByRole('region')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Nothing opened yet' })).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Browse folders' }));
});

test('show all updates section counts and removes the cap control', async () => {
  await showRecent(
    Array.from({ length: 15 }, (_, id) => ({
      ...folder,
      id: String(id),
      kind: id % 2 ? 'pr' : 'dir',
      lastOpened: id,
    })),
  );
  expect(screen.getAllByRole('listitem')).toHaveLength(12);
  await userEvent.click(screen.getByRole('button', { name: 'Show all 15' }));
  expect(screen.getAllByRole('listitem')).toHaveLength(15);
  expect(screen.getByRole('heading', { name: 'Pull requests 7' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Folders 8' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
});

test('a running pinned row has a filled Unpin button, two actions and no stop control', async () => {
  const item = { ...folder, pinned: true, state: 'running' };
  const { post } = await showRecent([item]);
  const pin = screen.getByRole('button', { name: 'Unpin' });
  expect(pin.querySelector('[class~="icon-[ph--push-pin-fill]"]')).toBeTruthy();
  expect(pin.classList.contains('opacity-0')).toBe(false);
  expect(screen.getAllByRole('button')).toHaveLength(2);
  expect(screen.queryByRole('button', { name: /Stop/ })).toBeNull();
  expect(screen.queryByText(/running/i)).toBeNull();
  await userEvent.click(pin);
  expect(post).toHaveBeenCalledWith('api/wb/pin', { id: 'folder', pinned: false });
});

test('keyboard users can reach Pin and Remove after the row link', async () => {
  const { post } = await showRecent([folder]);
  await userEvent.tab();
  expect(document.activeElement).toBe(screen.getByRole('link'));
  await userEvent.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Pin to the top' }));
  await userEvent.keyboard('{Enter}');
  expect(post).toHaveBeenCalledWith('api/wb/pin', { id: 'folder', pinned: true });
  await userEvent.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove from the list' }));
  await userEvent.keyboard('{Enter}');
  expect(post).toHaveBeenCalledWith('api/wb/remove', { id: 'folder' });
});

test.each([
  { state: 'starting', progress: 'Preparing workspace', subtitle: 'Preparing workspace' },
  { state: 'failed', error: 'Could not load workspace', subtitle: 'Could not load workspace' },
])('$state replaces the PR subtitle and chip', async ({ subtitle, ...status }) => {
  await showRecent([{ ...pr, ...status }]);
  expect(screen.getByText(subtitle)).toBeTruthy();
  expect(screen.queryByText('team/project')).toBeNull();
  expect(screen.queryByText('#37')).toBeNull();
});
