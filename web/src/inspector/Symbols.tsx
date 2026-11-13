import type { SymbolInfo } from '../editor/decode.ts';
import type { JSX } from 'solid-js';
import { createEffect, on } from 'solid-js';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { shortKind } from '../lsp/logic.ts';
export function Symbols(): JSX.Element {
  const editor = useEditor();
  let input: HTMLInputElement | undefined;
  createEffect(
    on(
      () => editor.store.state.layout.right && editor.store.state.layout.inspector === 'symbols',
      (visible) => {
        if (visible) input?.focus();
      },
    ),
  );
  const [query, setQuery] = createSignal('');
  const symbols = createMemo(() =>
    (editor.active()?.outline || []).filter((symbol) =>
      symbol.name.toLowerCase().includes(query().toLowerCase()),
    ),
  );
  function jump(symbol: SymbolInfo) {
    const document = editor.active();
    if (!document) return;
    editor.actions.patch({ cur: symbol.line });
    editor.actions.centerLine(symbol.line);
    editor.actions.pushHistory(document.path, symbol.line);
  }
  return (
    <>
      <div data-ui="search-form" class="flex flex-col gap-2 p-3">
        <input
          ref={input}
          id="right-symbols-filter"
          class="input h-8!"
          aria-label="Filter symbols"
          placeholder="Filter file symbols"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
      </div>
      <div class="panel-body min-h-0 flex-1 overflow-auto pb-4" id="right-symbols-list">
        <Show when={editor.language.symbols.loading}>
          <p>Loading symbols…</p>
        </Show>
        <Show when={editor.language.symbols.error}>
          <p role="alert">{editor.language.symbols.error.message}</p>
        </Show>
        <For each={symbols()}>
          {(symbol) => (
            <div
              role="button"
              tabindex="0"
              data-ui="sym"
              data-n={symbol.line}
              class="flex min-w-0 items-center gap-2 p-2 cursor-pointer hover:bg-accent [&.sel]:bg-accent"
              style={{
                'padding-left': `${10 + Math.min((symbol.indent || 0) - Math.min(...symbols().map((item) => item.indent || 0)), 16) * 5}px`,
              }}
              title={`Jump to ${symbol.name} at line ${symbol.line}`}
              onClick={() => jump(symbol)}
            >
              <span
                class="badge text-[var(--on-badge)]! bg-[var(--m)]! data-[k=func]:bg-[var(--nf)]! data-[k=method]:bg-[var(--nf)]! data-[k=fn]:bg-[var(--nf)]! data-[k=def]:bg-[var(--nf)]! data-[k=defp]:bg-[var(--nf)]! data-[k=class]:bg-[var(--nc)]! data-[k=struct]:bg-[var(--nc)]! data-[k=interface]:bg-[var(--nc)]! data-[k=type]:bg-[var(--nc)]! data-[k=enum]:bg-[var(--nc)]! data-[k=trait]:bg-[var(--nc)]! data-[k=record]:bg-[var(--nc)]! data-[k=protocol]:bg-[var(--nc)]! data-[k=const]:bg-[var(--kt)]! data-[k=var]:bg-[var(--kt)]! data-[k=let]:bg-[var(--kt)]! data-[k=val]:bg-[var(--kt)]! data-[k=module]:bg-[var(--nt)]! data-[k=mod]:bg-[var(--nt)]! data-[k=namespace]:bg-[var(--nt)]! data-[k=defmodule]:bg-[var(--nt)]! data-[k=impl]:bg-[var(--nt)]! data-[k=extension]:bg-[var(--nt)]!"
                data-variant="secondary"
                data-k={symbol.kind}
              >
                {shortKind(symbol.kind)}
              </span>
              <span data-ui="sn" class="truncate">
                {symbol.name}
              </span>
              <span data-ui="sl" class="ml-auto font-mono text-muted-foreground">
                {symbol.line}
              </span>
            </div>
          )}
        </For>
        <Show when={!symbols().length && !editor.language.symbols.loading}>
          <div data-ui="hint" class="empty text-muted-foreground">
            No symbols found.
          </div>
        </Show>
      </div>
    </>
  );
}
