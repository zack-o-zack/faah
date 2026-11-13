import { createEffect, on } from 'solid-js';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { shortKind } from '../lsp/logic.ts';
export function Symbols() {
  const editor = useEditor();
  let input;
  createEffect(
    on(
      () => editor.store.state.layout.right && editor.store.state.layout.inspector === 'symbols',
      (visible) => {
        if (visible) input.focus();
      },
    ),
  );
  const [query, setQuery] = createSignal('');
  const symbols = createMemo(() =>
    (editor.active()?.outline || []).filter((symbol) =>
      symbol.name.toLowerCase().includes(query().toLowerCase()),
    ),
  );
  function jump(symbol) {
    const document = editor.active();
    if (!document) return;
    editor.actions.patch({ cur: symbol.line });
    editor.actions.centerLine(symbol.line);
    editor.actions.pushHistory(document.path, symbol.line);
  }
  return (
    <>
      <input
        ref={input}
        id="right-symbols-filter"
        class="input m-2"
        aria-label="Filter symbols"
        placeholder="Filter file symbols"
        value={query()}
        onInput={(event) => setQuery(event.currentTarget.value)}
      />
      <div class="min-h-0 flex-1 overflow-auto" id="right-symbols-list">
        <Show when={editor.language.symbols.loading}>
          <p>Loading symbols…</p>
        </Show>
        <Show when={editor.language.symbols.error}>
          <p role="alert">{editor.language.symbols.error.message}</p>
        </Show>
        <For each={symbols()}>
          {(symbol) => (
            <button
              data-ui="sym"
              data-n={symbol.line}
              class="btn flex w-full gap-2 text-left text-xs"
              title={`Jump to ${symbol.name} at line ${symbol.line}`}
              onClick={() => jump(symbol)}
            >
              <span class="badge">{shortKind(symbol.kind)}</span>
              <span class="min-w-0 flex-1 truncate">{symbol.name}</span>
              <span>{symbol.line}</span>
            </button>
          )}
        </For>
      </div>
    </>
  );
}
