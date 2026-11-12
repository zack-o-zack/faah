import { render, screen, waitFor } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { Holding } from './Holding.jsx';
import { holdingUpdate } from './logic.js';
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
