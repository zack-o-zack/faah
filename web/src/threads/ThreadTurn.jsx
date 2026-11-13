import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { Markdown } from '../lib/Markdown.jsx';
import { ErrorNotice } from '../lib/ErrorNotice.jsx';
import { explainEvidenceLine, explainStaleLabel } from './references.ts';
import { turnDuration } from './logic.ts';
export function ThreadTurn(props) {
  const editor = useEditor();
  const open = (target) => {
    void editor.actions.openFile(target.path, { line: target.line || 1 }).then(() => {
      if (target.end)
        editor.actions.setNavigation({
          reference: { path: target.path, l1: target.line, l2: target.end },
        });
    });
  };
  return (
    <section data-turn={props.turn.id} class="flex flex-col gap-2">
      <div class="ml-8 self-end rounded bg-muted px-3 py-2">
        <Markdown text={props.turn.prompt} onOpen={open} />
      </div>
      <article class="thr-agent min-w-0 text-sm">
        <p class="text-xs text-muted-foreground">
          {props.turn.harness || 'agent'} {props.turn.model || ''} · {turnDuration(props.turn.ms)}
        </p>
        <Show when={props.turn.running}>
          <p role="status">{props.turn.tools?.at(-1) || 'Starting…'}</p>
        </Show>
        <Show when={props.turn.tools?.length}>
          <details>
            <summary>{props.turn.tools.length} steps</summary>
            <ol class="list-decimal pl-4">
              <For each={props.turn.tools}>
                {(step) => <li class="whitespace-pre-wrap">{step}</li>}
              </For>
            </ol>
          </details>
        </Show>
        <Markdown
          text={props.turn.reply}
          refs={
            props.thread.kind === 'explain' && !props.turn.running ? props.turn.refs || {} : null
          }
          onOpen={open}
        />
        <For each={props.turn.notes}>
          {(note) => (
            <button
              class="btn whitespace-pre-wrap"
              onClick={() => open({ path: note.path, line: note.l1, end: note.l2 })}
            >
              {note.path}:{note.l1} · {note.summary}
            </button>
          )}
        </For>
        <For each={props.turn.walkthroughs}>
          {(walk) => (
            <section class="rounded border p-2">
              <strong>{walk.title}</strong>
              <ol class="list-decimal pl-4">
                <For each={walk.steps}>
                  {(step) => (
                    <li>
                      <button
                        class="btn"
                        onClick={() => open({ path: step.path, line: step.l1, end: step.l2 })}
                      >
                        {step.title}
                      </button>
                      <p>{step.body}</p>
                    </li>
                  )}
                </For>
              </ol>
            </section>
          )}
        </For>
        <ErrorNotice error={props.turn.error} />
        <Show when={!props.turn.running && props.turn.changed?.length}>
          <div class="flex flex-wrap gap-1">
            <For each={props.turn.changed}>
              {(path) => (
                <button
                  class="btn max-w-full truncate font-mono text-xs"
                  data-control="thr-file"
                  onClick={() => editor.actions.openThreadFile(props.turn, path)}
                >
                  {path}
                </button>
              )}
            </For>
            <Show when={props.turn.beforeSha && !props.turn.reverted}>
              <button
                class="btn"
                disabled={!!editor.threads.state.pending}
                onClick={() => {
                  if (confirm('Revert files changed in this turn?'))
                    void editor.actions.revertThreadTurn(props.thread.id, props.turn.id);
                }}
              >
                Revert turn
              </button>
            </Show>
            <Show when={props.turn.reverted}>
              <span>Reverted</span>
            </Show>
          </div>
        </Show>
        <Show when={!props.turn.running && props.turn.tracked === false}>
          <p>Changes are unknown outside Git; the workspace was reloaded.</p>
        </Show>
        <Show when={props.thread.kind === 'explain' && props.turn.id === 1 && !props.turn.running}>
          <footer class="text-xs text-muted-foreground">
            {explainEvidenceLine(props.thread.evidence)}{' '}
            <Show when={editor.threads.state.stale?.id === props.thread.id}>
              {explainStaleLabel(editor.threads.state.stale.reason)}
            </Show>
            <Show when={props.thread.explainReq}>
              <button
                class="btn"
                onClick={() => void editor.actions.explainSelection(props.thread.explainReq, true)}
              >
                Re-explain
              </button>
            </Show>
          </footer>
        </Show>
      </article>
    </section>
  );
}
