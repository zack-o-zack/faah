import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { Popover } from '../lib/Popover.jsx';
export function LspMenu() {
  const editor = useEditor();
  const language = editor.language;
  return (
    <span id="st-lsp">
      <Popover
        label="LSP"
        open={language.state.menuOpen}
        onOpenChange={editor.actions.setLspMenuOpen}
      >
        <div id="lsp-menu" class="flex max-h-96 w-80 flex-col gap-2 overflow-auto p-2 text-xs">
          <strong>Language servers</strong>
          <Show when={language.servers.loading}>
            <p>Loading…</p>
          </Show>
          <Show when={language.state.error}>
            <p role="alert">{language.state.error}</p>
          </Show>
          <For each={editor.store.state.lsp.servers}>
            {(server) => (
              <section class="flex items-center gap-2">
                <span class="min-w-0 flex-1 truncate" title={server.error}>
                  {server.name} · {server.state || 'off'}
                </span>
                <Show
                  when={server.installed}
                  fallback={
                    <Show
                      when={server.autoOpt >= 0}
                      fallback={
                        <Show when={server.options?.[0]}>
                          <button
                            class="btn"
                            onClick={() =>
                              void navigator.clipboard.writeText(server.options[0].cmd)
                            }
                          >
                            Copy command
                          </button>
                        </Show>
                      }
                    >
                      <button
                        class="btn"
                        disabled={!!language.state.pending}
                        onClick={() =>
                          void editor.actions.runLspAction('install', {
                            server: server.name,
                            option: server.autoOpt,
                          })
                        }
                      >
                        Install
                      </button>
                    </Show>
                  }
                >
                  <button
                    class="btn"
                    disabled={!!language.state.pending}
                    onClick={() =>
                      void editor.actions.runLspAction(server.running ? 'stop' : 'start', {
                        server: server.name,
                      })
                    }
                  >
                    {server.running ? 'Stop' : 'Start'}
                  </button>
                </Show>
              </section>
            )}
          </For>
          <Show when={!editor.store.state.lsp.servers.length}>
            <p>No language servers detected for workspace.</p>
          </Show>
          <div class="flex gap-2">
            <button class="btn" onClick={() => void editor.actions.startAllLsp()}>
              Start all
            </button>
            <button class="btn" onClick={() => void editor.actions.stopAllLsp()}>
              Stop all
            </button>
          </div>
        </div>
      </Popover>
    </span>
  );
}
