import type { JSX } from 'solid-js';
import type { Thread, ThreadTurn } from './decode.ts';
import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
export function ThreadChanges(props: { turn: ThreadTurn; thread?: Thread | null }): JSX.Element {
  const editor = useEditor();
  return (
    <Show when={!props.turn.running}>
      <Show
        when={props.turn.changed?.length}
        fallback={
          <Show when={props.turn.tracked === false}>
            <div data-ui="thr-changed" class="flex items-center flex-wrap gap-2">
              <span data-ui="thr-changed-label" class="text-xs text-muted-foreground">
                Changes unknown outside a git repository; the workspace was reloaded.
              </span>
            </div>
          </Show>
        }
      >
        <div data-ui="thr-changed" class="flex items-center flex-wrap gap-2">
          <div data-ui="thr-changed-head" class="flex items-center justify-between w-full gap-2">
            <span data-ui="thr-changed-label" class="text-xs text-muted-foreground">
              {props.thread?.kind === 'explain'
                ? 'Files changed during this explanation'
                : `Changed ${props.turn.changed?.length} ${props.turn.changed?.length === 1 ? 'file' : 'files'}`}
            </span>
            <Show when={props.turn.beforeSha}>
              <Show
                when={!props.turn.reverted}
                fallback={
                  <span class="badge" data-variant="outline" data-control="thr-reverted-badge">
                    Reverted
                  </span>
                }
              >
                <button
                  type="button"
                  class="btn"
                  data-control="thr-revert-btn"
                  data-variant="outline"
                  data-size="xs"
                  title="Revert files modified in this turn back to pre-turn snapshot"
                  disabled={!!editor.threads.state.pending}
                  onClick={() => {
                    if (confirm('Revert files changed in this turn?'))
                      void editor.actions.revertThreadTurn(props.thread?.id || '', props.turn.id);
                  }}
                >
                  Revert turn
                </button>
              </Show>
            </Show>
          </div>
          <For each={props.turn.changed}>
            {(path) => (
              <button
                class="btn max-w-full font-mono"
                data-control="thr-file"
                data-variant="outline"
                data-size="xs"
                title={`Review changes in ${path}`}
                onClick={() => editor.actions.openThreadFile(props.turn, path)}
              >
                <span class="icon-[lucide--file-diff] size-3" aria-hidden="true" />
                <span class="truncate">{path}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </Show>
  );
}
