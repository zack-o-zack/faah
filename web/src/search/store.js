import { createResource, createSignal, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import { api } from '../lib/api.js';
import { searchRequest } from './logic.js';
/** @returns {{query:string,glob:string,caseSensitive:boolean,word:boolean,regex:boolean,external:object|null}} */
function initialState() {
  return { query: '', glob: '', caseSensitive: false, word: false, regex: false, external: null };
}
export function createSearchStore(options = {}) {
  const request = options.request || api;
  const [state, set] = createStore(initialState());
  const [key, setKey] = createSignal(false);
  let timer, controller;
  const [results] = createResource(key, async (params) => {
    controller?.abort();
    controller = new AbortController();
    return request('api/search', params, { signal: controller.signal });
  });
  function runSearch() {
    clearTimeout(timer);
    controller?.abort();
    set('external', null);
    setKey(state.query.trim() ? searchRequest(state) : false);
  }
  function setSearchField(name, value) {
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
      setSearchResults: (result) => set('external', result),
      searchWorkspace(query, patch = {}) {
        set({ query, ...patch });
        runSearch();
      },
    },
  };
}
