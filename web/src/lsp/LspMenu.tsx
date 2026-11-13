import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { LspServerRow } from './LspServerRow.tsx';
import { Dialog } from '../lib/Dialog.tsx';
export function LspMenu(): JSX.Element {
  const editor = useEditor();
  const language = editor.language;
  return (
    <Show when={language.state.menuOpen}>
      <Dialog
        open={true}
        bare
        title="Language servers"
        onClose={() => editor.actions.setLspMenuOpen(false)}
      >
        <div id="lsp-menu" class="overflow-auto">
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
        </div>
      </Dialog>
    </Show>
  );
}
