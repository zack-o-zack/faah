import { required } from '../lib/test-values.ts';
import { record } from '../lib/decode.ts';
import { createEditorStore } from '../editor/store.ts';
import { createAppStore } from '../app/store.ts';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, test, vi } from 'vitest';
import { createRoot } from 'solid-js';
import { createSearchStore } from './store.ts';
import { searchRequest, groupHits } from './logic.ts';
import { Search } from './Search.tsx';
import { EditorProvider } from '../editor/context.tsx';
afterEach(() => vi.useRealTimers());
test('query options shape requests and references group by file', () => {
  expect(
    searchRequest({ query: 'a', glob: '*.go', word: true, caseSensitive: false, regex: false }),
  ).toEqual({
    q: 'a',
    glob: '*.go',
    word: 1,
    case: '',
    re: '',
  });
  expect(
    required(
      groupHits([
        { path: 'a', line: 1 },
        { path: 'a', line: 2 },
      ])[0],
    ).matches,
  ).toHaveLength(2);
});
test('a newer resource key owns results even when the old request ignores abort', async () => {
  let finish: (() => void) | undefined;
  let dispose: (() => void) | undefined;
  const search = createRoot((cleanup) => {
    dispose = cleanup;
    return createSearchStore({
      request: async (_, params) => {
        if (record(params).q === 'old')
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
        return { header: record(params).q, results: [] };
      },
    });
  });
  try {
    search.actions.searchWorkspace('old');
    search.actions.searchWorkspace('new');
    await vi.waitFor(() => expect(search.data()).toMatchObject({ header: 'new' }));
    required(finish)();
    await Promise.resolve();
    await Promise.resolve();
    expect(search.data()).toMatchObject({ header: 'new' });
  } finally {
    required(dispose)();
  }
});
test('renders results and sends case/word/regex/glob through named actions', async () => {
  let search: ReturnType<typeof createSearchStore> | undefined;
  const request = vi.fn(async (_path: string, _params?: unknown) => ({
    total: 1,
    files: 1,
    results: [{ path: 'one.go', matches: [{ line: 1, mid: 'needle' }] }],
  }));
  render(() => {
    search = createSearchStore({ request });
    const base = createEditorStore(createAppStore());
    return (
      <EditorProvider value={{ ...base, search, actions: { ...base.actions, ...search.actions } }}>
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
  required(search).actions.runSearch();
  await waitFor(() => expect(document.querySelector('[data-ui=rline]')).toBeTruthy());
  expect(required(request.mock.calls.at(-1))[1]).toEqual({
    q: 'needle',
    glob: '*.go',
    case: 1,
    word: 1,
    re: 1,
  });
  fireEvent.input(screen.getByRole('textbox', { name: 'Search in files' }), {
    target: { value: '' },
  });
  expect(document.querySelector('[data-ui=rline]')).toBeNull();
  expect(screen.getByText('Search text across every indexed file.')).toBeTruthy();
});
