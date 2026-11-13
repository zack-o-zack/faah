import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { Popover } from '../lib/Popover.jsx';
export function LspMenu() {
  const editor = useEditor();
  const language = editor.language;
  return (
    <>
      <Popover
        triggerId="st-lsp"
        triggerClass="btn text-muted-foreground"
        panelId="lsp-menu"
        gap={6}
        label={
          <>
            <span class="size-1.5 shrink-0 rounded-full bg-faint" aria-hidden="true" />
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
            <div data-ui="lsp-empty-note" class="col-span-full py-2 text-muted-foreground">
              No language servers detected for workspace
            </div>
          </Show>
        </div>
      </Popover>
    </>
  );
}
