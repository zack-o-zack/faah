import { render, screen, waitFor } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { Holding } from './Holding.jsx';
import { holdingUpdate } from './logic.ts';
import { createStore } from 'solid-js/store';
test('holding state reloads only after startup ends', () => {
  expect(holdingUpdate([{ href: '/', state: 'starting', progress: 'Indexing' }], '/')).toEqual({
    reload: false,
    progress: 'Indexing',
  });
  expect(holdingUpdate([], '/')).toEqual({ reload: true });
});
test('holding renders escaped errors and recovery links', () => {
  render(() => (
    <Holding
      data={{
        Title: 'repo',
        Error: '<script>failed</script>',
        Retry: '/retry',
        Choose: '/choose',
        Base: '/',
      }}
    />
  ));
  expect(screen.getByRole('alert').textContent).toContain('<script>failed</script>');
  expect(document.querySelector('script')).toBeNull();
  expect(screen.getByRole('link', { name: 'Retry' }).getAttribute('href')).toBe('/retry');
});
test('holding updates progress and disposes polling on unmount', async () => {
  const request = vi.fn(async () => ({
    items: [{ href: '/', state: 'starting', progress: 'Indexing' }],
  }));
  const view = render(() => (
    <Holding data={{ Starting: true, Title: 'repo', Base: '/' }} request={request} />
  ));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Indexing'));
  view.unmount();
  expect(request).toHaveBeenCalledOnce();
});

test('initial progress stays derived and prop changes do not restart polling', async () => {
  const [data, set] = createStore({
    Starting: true,
    Progress: 'Cloning',
    Title: 'repo',
    Base: '/',
  });
  let finish;
  let signal;
  const request = vi.fn((path, params, options) => {
    signal = options.signal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const view = render(() => <Holding data={data} request={request} />);
  expect(screen.getByRole('status').textContent).toContain('Cloning');
  set('Progress', 'Preparing');
  expect(screen.getByRole('status').textContent).toContain('Preparing');
  expect(request).toHaveBeenCalledOnce();
  finish({ items: [{ href: '/', state: 'starting', progress: 'Indexing' }] });
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Indexing'));
  set('Progress', 'Older progress');
  expect(screen.getByRole('status').textContent).toContain('Indexing');
  view.unmount();
  expect(signal.aborted).toBe(true);
});
