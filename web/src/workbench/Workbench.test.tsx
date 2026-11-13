import { required } from '../lib/test-values.ts';
import { record } from '../lib/decode.ts';
import { render, screen, waitFor } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { createWorkbenchStore } from './store.ts';
import { WorkbenchProvider } from './context.tsx';
import { ThemeProvider } from '../lib/theme-context.tsx';
import { Workbench } from './Workbench.tsx';
test('fresh workbench loads recents, browses and opens a folder', async () => {
  const request = vi.fn(async (path) =>
    path === 'api/wb/state'
      ? { items: [], cwd: '/code', home: '/home', sep: '/' }
      : { path: '/code', parent: '/', entries: [{ name: 'repo', path: '/code/repo', git: true }] },
  );
  const post = vi.fn(async () => ({ href: '/w/repo/' }));
  const navigate = vi.fn();
  const store = createWorkbenchStore(request, post, navigate);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ cpuUsage: 0, rssBytes: 1024 }));
  const view = render(() => (
    <ThemeProvider>
      <WorkbenchProvider store={store}>
        <Workbench />
      </WorkbenchProvider>
    </ThemeProvider>
  ));
  await waitFor(() => expect(request).toHaveBeenCalledWith('api/wb/state'));
  await userEvent.click(screen.getByRole('tab', { name: 'Browse' }));
  expect(await screen.findByRole('option', { name: 'repo' })).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Open this folder' }));
  expect(post).toHaveBeenCalledWith('api/wb/open', { target: '/code' });
  expect(navigate).toHaveBeenCalledWith('/w/repo/');
  view.unmount();
});
test('clone requests preserve the original PR and cancellation restores tab', async () => {
  const post = vi.fn(async (_path: string, body?: unknown) =>
    record(body).clone
      ? { href: '/w/pr/' }
      : { needClone: true, repo: 'org/repo', managed: '/managed' },
  );
  const navigate = vi.fn();
  const store = createWorkbenchStore(vi.fn(), post, navigate);
  await store.actions.open('https://host/repo/pull/1');
  expect(store.state.tab).toBe('browse');
  await store.actions.useFolder('/clone');
  expect(post).toHaveBeenLastCalledWith('api/wb/open', {
    target: 'https://host/repo/pull/1',
    clone: '/clone',
  });
  store.actions.cancelClone();
  expect(store.state.clone).toBeNull();
  expect(store.state.tab).toBe('recent');
});

test('stale refreshes and workspace opens cannot replace newer results', async () => {
  const refreshes: ((value: unknown) => void)[] = [];
  const opens: ((value: unknown) => void)[] = [];
  const navigate = vi.fn();
  const store = createWorkbenchStore(
    (path) =>
      path === 'api/wb/state'
        ? new Promise<unknown>((resolve) => refreshes.push(resolve))
        : Promise.resolve({ path: '/code', entries: [] }),
    () => new Promise<unknown>((resolve) => opens.push(resolve)),
    navigate,
  );
  const first = store.actions.refresh();
  const second = store.actions.refresh();
  required(refreshes[1])({ items: [], version: 'new' });
  await second;
  required(refreshes[0])({ items: [], version: 'old' });
  await first;
  expect(store.state.version).toBe('new');
  const oldOpen = store.actions.open('/old');
  const newOpen = store.actions.open('/new');
  required(opens[1])({ href: '/w/new/' });
  await newOpen;
  required(opens[0])({ href: '/w/old/' });
  await oldOpen;
  expect(navigate).toHaveBeenCalledExactlyOnceWith('/w/new/');
});
