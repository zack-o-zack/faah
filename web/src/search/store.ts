import type { Request } from '../lib/api.ts';
import type { SearchFields, SearchParams } from './logic.ts';
import { decodeSearch } from './decode.ts';
import type { SearchReply } from './decode.ts';
interface SearchState extends SearchFields {
  external: SearchReply | null;
}
import { createResource, createSignal, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import { api } from '../lib/api.ts';
import { searchRequest } from './logic.ts';

function initialState(): SearchState {
  return { query: '', glob: '', caseSensitive: false, word: false, regex: false, external: null };
}
export function createSearchStore(options: { request?: Request } = {}) {
  const request = options.request || api;
  const [state, set] = createStore(initialState());
  const [key, setKey] = createSignal<SearchParams | false>(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const [results] = createResource(key, async (params) => {
    controller?.abort();
    controller = new AbortController();
    return decodeSearch(await request('api/search', params, { signal: controller.signal }));
  });
  function runSearch() {
    clearTimeout(timer);
    controller?.abort();
    set('external', null);
    setKey(state.query.trim() ? searchRequest(state) : false);
  }
  function setSearchField(name: keyof SearchFields, value: string | boolean): void {
    if ((name === 'query' || name === 'glob') && typeof value === 'string') set(name, value);
    else if (
      (name === 'caseSensitive' || name === 'word' || name === 'regex') &&
      typeof value === 'boolean'
    )
      set(name, value);
    set('external', null);
    clearTimeout(timer);
    timer = setTimeout(runSearch, 160);
  }
  onCleanup(() => {
    clearTimeout(timer);
    controller?.abort();
  });
  return {
    state,
    results,
    data: () => state.external || (!results.error && results()),
    actions: {
      setSearchField,
      runSearch,
      cancelSearch() {
        clearTimeout(timer);
        controller?.abort();
      },
      setSearchResults: (result: SearchReply) => set('external', result),
      searchWorkspace(query: string, patch: Partial<SearchFields> = {}): void {
        set({ query, ...patch });
        runSearch();
      },
    },
  };
}
