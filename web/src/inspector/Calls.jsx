import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { CallNode } from './CallNode.jsx';
import { LspSetup } from '../lsp/LspSetup.jsx';
import { Kbd } from '../lib/shortcuts.jsx';
export function Calls() {
  const editor = useEditor();
  const language = editor.language;
  return (
    <>
      <div class="flex shrink-0 items-center gap-2 border-b p-2 text-xs">
        <span id="right-calls-target" class="min-w-0 flex-1 truncate">
          {language.state.calls?.word}
        </span>
        <div role="group" id="calls-dir" class="button-group">
          <button
            class="btn"
            aria-pressed={language.state.direction === 'in'}
            onClick={() => editor.actions.setCallDirection('in')}
          >
            Callers
          </button>
          <button
            class="btn"
            aria-pressed={language.state.direction === 'out'}
            onClick={() => editor.actions.setCallDirection('out')}
          >
            Callees
          </button>
        </div>
      </div>
      <div class="min-h-0 flex-1 overflow-auto" id="right-calls-list">
        <Show
          when={['off', 'failed'].includes(editor.active()?.lsp?.state || 'off')}
          fallback={
            <>
              <Show when={!language.state.calls}>
                <p class="p-3 text-xs">
                  Click a function name, then press <Kbd combo="Alt+Shift+H" />.
                </p>
              </Show>
              <Show when={language.calls.loading}>
                <p>Tracing calls…</p>
              </Show>
              <Show when={language.calls.error}>
                <p role="alert">{language.calls.error.message}</p>
              </Show>
              <Show when={!language.calls.error && language.calls()}>
                {(data) => (
                  <For each={data().nodes}>
                    {(node) => (
                      <CallNode
                        node={node}
                        ancestors={[]}
                        root={true}
                        path={language.state.calls.path}
                      />
                    )}
                  </For>
                )}
              </Show>
            </>
          }
        >
          <LspSetup />
        </Show>
      </div>
    </>
  );
}
