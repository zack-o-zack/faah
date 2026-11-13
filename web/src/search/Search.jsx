import { createEffect, on } from 'solid-js';
import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { ResultGroup } from './ResultGroup.jsx';
import { resultHeading } from './logic.ts';
export function Search() {
  const editor = useEditor();
  let input;
  createEffect(
    on(
      () => editor.store.state.layout.right && editor.store.state.layout.inspector === 'search',
      (visible) => {
        if (visible) input.focus();
      },
    ),
  );
  const search = editor.search;
  return (
    <>
      <div class="flex shrink-0 flex-col gap-2 p-3">
        <input
          ref={input}
          id="q"
          class="input"
          aria-label="Search in files"
          placeholder="Search in files"
          value={search.state.query}
          onInput={(event) => editor.actions.setSearchField('query', event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              editor.actions.runSearch();
            }
          }}
        />
        <div class="flex gap-1">
          <For
            each={[
              ['caseSensitive', 'Match case', 'Aa', 'o-case'],
              ['word', 'Whole word', '|ab|', 'o-word'],
              ['regex', 'Regular expression', '.*', 'o-re'],
            ]}
          >
            {(option) => (
              <button
                id={option[3]}
                class="btn"
                aria-label={option[1]}
                title={option[1]}
                aria-pressed={search.state[option[0]]}
                onClick={() => editor.actions.setSearchField(option[0], !search.state[option[0]])}
              >
                {option[2]}
              </button>
            )}
          </For>
        </div>
        <input
          id="glob"
          class="input"
          aria-label="Files to include"
          placeholder="Files to include e.g. *.go"
          value={search.state.glob}
          onInput={(event) => editor.actions.setSearchField('glob', event.currentTarget.value)}
        />
      </div>
      <div id="results" class="min-h-0 flex-1 overflow-auto">
        <Show when={search.results.loading && !search.state.external}>
          <p class="p-2">Searching…</p>
        </Show>
        <Show when={search.results.error && !search.state.external}>
          <p role="alert">{search.results.error.message}</p>
        </Show>
        <Show when={search.data()}>
          {(data) => (
            <>
              <p class="p-2 text-xs text-muted-foreground">{resultHeading(data())}</p>
              <For each={data().results}>
                {(file) => <ResultGroup file={file} query={search.state.query} />}
              </For>
              <Show when={!data().results?.length}>
                <p>No results.</p>
              </Show>
            </>
          )}
        </Show>
      </div>
    </>
  );
}
