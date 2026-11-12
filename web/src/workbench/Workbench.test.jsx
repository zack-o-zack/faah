import { render, screen, waitFor } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { createWorkbenchStore } from './store.js';
import { WorkbenchProvider } from './context.jsx';
import { ThemeProvider } from '../lib/theme-context.jsx';
import { Workbench } from './Workbench.jsx';
test('fresh workbench loads recents, browses and opens a folder', async () => {
  const request = vi.fn(async (path) =>
    path === 'api/wb/state'
      ? { items: [], cwd: '/code', home: '/home', sep: '/' }
      : { path: '/code', parent: '/', entries: [{ name: 'repo', path: '/code/repo', git: true }] },
  );
  const post = vi.fn(async () => ({ href: '/w/repo/' }));
  const navigate = vi.fn();
  const store = createWorkbenchStore(request, post, navigate);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    json: async () => ({ cpuUsage: 0, rssBytes: 1024 }),
  });
  const view = render(() => (
    <ThemeProvider>
      <WorkbenchProvider store={store}>
        <Workbench />
      </WorkbenchProvider>
    </ThemeProvider>
  ));
  await waitFor(() => expect(request).toHaveBeenCalledWith('api/wb/state'));
  await userEvent.click(screen.getByRole('tab', { name: 'browse' }));
  expect(await screen.findByRole('option', { name: 'repo' })).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Open this folder' }));
  expect(post).toHaveBeenCalledWith('api/wb/open', { target: '/code' });
  expect(navigate).toHaveBeenCalledWith('/w/repo/');
  view.unmount();
});
test('clone requests preserve the original PR and cancellation restores tab', async () => {
  const post = vi.fn(async (_, body) =>
    body.clone ? { href: '/w/pr/' } : { needClone: true, repo: 'org/repo', managed: '/managed' },
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
