import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { lspStatus } from './logic.ts';
import { LspServerRow } from './LspServerRow.tsx';
import { Popover } from '../lib/Popover.tsx';
export function LspMenu(): JSX.Element {
  const editor = useEditor();
  const language = editor.language;
  const status = () =>
    lspStatus(
      editor.store.state.lsp.servers,
      editor.store.state.lsp.state,
      editor.store.state.lsp.anyRunning,
    );
  return (
    <>
      <Popover
        triggerId="st-lsp"
        accessibleLabel={status().title}
        triggerTitle={status().title}
        triggerClass="btn text-muted-foreground"
        panelId="lsp-menu"
        gap={6}
        label={
          <>
            <span class={`size-1.5 shrink-0 rounded-full ${status().dot}`} aria-hidden="true" />
            <Show when={status().count}>
              <span class="tabular-nums">{status().count}</span>{' '}
            </Show>
            LSP
          </>
        }
        open={language.state.menuOpen}
        onOpenChange={editor.actions.setLspMenuOpen}
      >
        <div
          data-ui="lsp-menu-head"
          class="px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground"
        >
          Language servers
        </div>
        <div
          data-ui="lsp-server-list"
          class="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-3 gap-y-0.5 pl-2 text-xs"
        >
          <Show when={language.servers.loading}>
            <p>Loading…</p>
          </Show>
          <Show when={language.state.error}>
            <p role="alert">{language.state.error}</p>
          </Show>
          <For each={editor.store.state.lsp.servers}>
            {(server) => (
              <LspServerRow
                server={server}
                pending={!!language.state.pending}
                onAction={(kind, params) => void editor.actions.runLspAction(kind, params)}
              />
            )}
          </For>
          <Show when={!editor.store.state.lsp.servers.length}>
            <div data-ui="lsp-empty-note" class="col-span-full py-2 text-muted-foreground">
              No language servers detected for workspace
            </div>
          </Show>
        </div>
      </Popover>
    </>
  );
}
