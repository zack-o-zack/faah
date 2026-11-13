import type { ThreadTurn as Turn, Thread } from './decode.ts';
interface ThreadTurnProps {
  turn: Turn;
  thread?: Thread | null;
}
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { ThreadSteps } from './ThreadSteps.tsx';
import { ThreadChanges } from './ThreadChanges.tsx';
import { ThreadArtifacts } from './ThreadArtifacts.tsx';
import { Markdown } from '../lib/Markdown.tsx';
import { ErrorNotice } from '../lib/ErrorNotice.tsx';
import { explainEvidenceLine, explainStaleLabel } from './references.ts';
import { turnDuration } from './logic.ts';
export function ThreadTurn(props: ThreadTurnProps): JSX.Element {
  const editor = useEditor();
  const open = (target: { path: string; line?: number; end?: number }) => {
    void editor.actions.openFile(target.path, { line: target.line || 1 }).then(() => {
      if (target.end)
        editor.actions.setNavigation({
          reference: { path: target.path, l1: target.line || 1, l2: target.end },
        });
    });
  };
  return (
    <>
      <div
        data-ui="thr-msg"
        class="thr-user ml-8 self-end min-w-0 rounded-lg bg-muted px-3 py-2 text-sm"
      >
        <Markdown text={props.turn.prompt || ''} onOpen={open} />
      </div>
      <article
        data-ui="thr-msg"
        data-turn={props.turn.id}
        class="thr-agent flex min-w-0 flex-col gap-2 text-sm"
      >
        <div data-ui="thr-who" class="text-xs text-muted-foreground">
          {props.turn.harness || 'agent'}
          {props.turn.model ? ' · ' + props.turn.model : ''}
          <Show when={!props.turn.running && props.turn.ms}>
            {' · '}
            <span
              title={
                props.turn.firstMs
                  ? `First words after ${turnDuration(props.turn.firstMs)}`
                  : undefined
              }
            >
              {turnDuration(props.turn.ms)}
            </span>
          </Show>
        </div>
        <ThreadSteps turn={props.turn} />
        <Markdown
          text={props.turn.reply || ''}
          refs={
            props.thread?.kind === 'explain' && !props.turn.running ? props.turn.refs || {} : null
          }
          onOpen={open}
        />
        <ThreadArtifacts turn={props.turn} onOpen={open} />
        <ErrorNotice title="The run failed" error={props.turn.error} />
        <Show when={props.thread?.kind === 'explain' && props.turn.id === 1 && !props.turn.running}>
          <footer
            data-ui="thr-evidence"
            class="flex items-center flex-wrap gap-2 font-mono text-muted-foreground"
          >
            <span>{explainEvidenceLine(props.thread?.evidence)}</span>
            <Show when={editor.threads.state.stale?.id === props.thread?.id}>
              <span data-ui="thr-stale">
                {explainStaleLabel(editor.threads.state.stale?.reason || '')}
              </span>
            </Show>
            <Show when={props.thread?.explainReq}>
              <button
                class="btn"
                data-control="thr-evidence-btn"
                data-variant="outline"
                data-size="xs"
                onClick={() => {
                  const target = props.thread?.explainReq;
                  if (target) void editor.actions.explainSelection(target, true);
                }}
              >
                {editor.threads.state.stale?.id === props.thread?.id ? 'Refresh' : 'Re-explain'}
              </button>
            </Show>
          </footer>
        </Show>
        <ThreadChanges turn={props.turn} thread={props.thread} />
      </article>
    </>
  );
}
