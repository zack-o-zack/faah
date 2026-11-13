import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { installLog } from './logic.js';
export function LspSetup() {
  const editor = useEditor();
  const language = editor.language;
  return (
    <div class="flex flex-col gap-2 p-3 text-xs">
      <Show when={language.setup.error}>
        <p role="alert">{language.setup.error.message}</p>
      </Show>
      <Show when={!language.setup.error && language.setup()}>
        {(setup) => (
          <>
            <Show
              when={setup().enabled}
              fallback={
                <p>
                  Language servers are turned off. Restart without -no-lsp for call trails, hover
                  and precise references.
                </p>
              }
            >
              <p>
                {setup().reason ||
                  `Language services for ${setup().lang || editor.active()?.name} need a running server.`}
              </p>
              <For each={setup().servers}>
                {(server) => (
                  <section class="card p-2">
                    <strong>{server.name}</strong>
                    <For each={server.options}>
                      {(option, index) => (
                        <div class="flex flex-wrap gap-2">
                          <code>{option.cmd}</code>
                          <button
                            class="btn"
                            onClick={() => void navigator.clipboard.writeText(option.cmd)}
                          >
                            Copy
                          </button>
                          <Show when={option.auto && option.hasTool}>
                            <button
                              class="btn"
                              disabled={!!language.state.pending || server.job?.running}
                              onClick={() =>
                                void editor.actions.runLspAction('install', {
                                  server: server.name,
                                  option: index(),
                                })
                              }
                            >
                              Install
                            </button>
                          </Show>
                          <Show when={!option.hasTool}>
                            <span>Needs {option.tool || 'manual installation'}</span>
                          </Show>
                        </div>
                      )}
                    </For>
                    <Show when={server.job}>
                      <pre class="max-h-40 overflow-auto whitespace-pre-wrap">
                        {server.job.error || ''}
                        {installLog(server.job)}
                      </pre>
                    </Show>
                  </section>
                )}
              </For>
              <button
                class="btn"
                disabled={!!language.state.pending}
                onClick={() =>
                  void editor.actions.runLspAction('start', { path: editor.active()?.path })
                }
              >
                Detect and start
              </button>
            </Show>
          </>
        )}
      </Show>
      <Show when={language.state.error}>
        <p role="alert">{language.state.error}</p>
      </Show>
    </div>
  );
}
