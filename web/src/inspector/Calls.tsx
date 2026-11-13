import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { CallNode } from './CallNode.tsx';
import { LspSetup } from '../lsp/LspSetup.tsx';
import { keyLabel } from '../lib/keyboard.ts';
export function Calls(): JSX.Element {
  const editor = useEditor();
  const language = editor.language;
  return (
    <>
      <div class="inspector-bar flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2 text-xs">
        <span id="right-calls-target" class="inspector-sym-title truncate font-mono font-semibold">
          {language.state.calls?.word}
        </span>
        <div role="group" id="calls-dir" class="button-group">
          <button
            class="btn"
            data-dir="in"
            data-control="opt"
            data-size="xs"
            data-variant={language.state.direction === 'in' ? 'secondary' : 'outline'}
            aria-pressed={language.state.direction === 'in' ? true : undefined}
            onClick={() => editor.actions.setCallDirection('in')}
          >
            Callers
          </button>
          <button
            class="btn"
            data-dir="out"
            data-control="opt"
            data-size="xs"
            data-variant={language.state.direction === 'out' ? 'secondary' : 'outline'}
            aria-pressed={language.state.direction === 'out' ? true : undefined}
            onClick={() => editor.actions.setCallDirection('out')}
          >
            Callees
          </button>
        </div>
      </div>
      <div class="panel-body min-h-0 flex-1 overflow-auto pb-4" id="right-calls-list">
        <Show
          when={['off', 'failed'].includes(editor.active()?.lsp?.state || 'off')}
          fallback={
            <>
              <Show when={!language.state.calls}>
                <div data-ui="hint" class="empty text-muted-foreground">
                  Click a function name, then press <b>{keyLabel('Alt+Shift+H')}</b> to trace its
                  calls.
                </div>
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
                        path={language.state.calls?.path || ''}
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
