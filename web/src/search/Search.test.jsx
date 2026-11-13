import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, test, vi } from 'vitest';
import { createRoot } from 'solid-js';
import { createSearchStore } from './store.ts';
import { searchRequest, groupHits } from './logic.ts';
import { Search } from './Search.jsx';
import { EditorProvider } from '../editor/context.jsx';
afterEach(() => vi.useRealTimers());
test('query options shape requests and references group by file', () => {
  expect(searchRequest({ query: 'a', glob: '*.go', word: true })).toEqual({
    q: 'a',
    glob: '*.go',
    word: 1,
    case: '',
    re: '',
  });
  expect(
    groupHits([
      { path: 'a', line: 1 },
      { path: 'a', line: 2 },
    ])[0].matches,
  ).toHaveLength(2);
});
test('a newer resource key owns results even when the old request ignores abort', async () => {
  let finish, dispose;
  const search = createRoot((cleanup) => {
    dispose = cleanup;
    return createSearchStore({
      request: async (_, params) => {
        if (params.q === 'old')
          await new Promise((resolve) => {
            finish = resolve;
          });
        return { header: params.q, results: [] };
      },
    });
  });
  try {
    search.actions.searchWorkspace('old');
    search.actions.searchWorkspace('new');
    await vi.waitFor(() => expect(search.data()?.header).toBe('new'));
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(search.data().header).toBe('new');
  } finally {
    dispose();
  }
});
test('renders results and sends case/word/regex/glob through named actions', async () => {
  let search;
  const request = vi.fn(async () => ({
    total: 1,
    files: 1,
    results: [{ path: 'one.go', matches: [{ line: 1, mid: 'needle' }] }],
  }));
  render(() => {
    search = createSearchStore({ request });
    return (
      <EditorProvider
        value={{
          search,
          actions: search.actions,
          store: { state: { layout: { right: false, inspector: 'search' } } },
        }}
      >
        <Search />
      </EditorProvider>
    );
  });
  fireEvent.input(screen.getByRole('textbox', { name: 'Search in files' }), {
    target: { value: 'needle' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Match case' }));
  fireEvent.click(screen.getByRole('button', { name: 'Whole word' }));
  fireEvent.click(screen.getByRole('button', { name: 'Regular expression' }));
  fireEvent.input(screen.getByRole('textbox', { name: 'Files to include' }), {
    target: { value: '*.go' },
  });
  search.actions.runSearch();
  await waitFor(() => expect(document.querySelector('[data-ui=rline]')).toBeTruthy());
  expect(request.mock.calls.at(-1)[1]).toEqual({
    q: 'needle',
    glob: '*.go',
    case: 1,
    word: 1,
    re: 1,
  });
});
