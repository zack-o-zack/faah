import { ThreadPeeks } from '../notes/ThreadPeeks.tsx';
import type { JSX } from 'solid-js';
import type { ThreadTurn } from './decode.ts';
import { For, Show } from 'solid-js';
interface ThreadArtifactsProps {
  turn: ThreadTurn;
  thread?: string;
  onOpen: (target: { path: string; line?: number; end?: number }) => void;
}
export function ThreadArtifacts(props: ThreadArtifactsProps): JSX.Element {
  return (
    <>
      <Show when={props.turn.notes?.length}>
        <Show
          when={!props.turn.running}
          fallback={
            <div class="text-xs text-muted-foreground">
              {props.turn.notes?.length} notes on the code
            </div>
          }
        >
          <ThreadPeeks thread={props.thread} turn={props.turn} onOpen={props.onOpen} />
        </Show>
      </Show>
      <For each={props.turn.walkthroughs}>
        {(walk) => (
          <div data-ui="thr-shown" class="rounded-md border px-2 py-1.5 text-xs">
            <div class="mb-1 font-mono text-muted-foreground">Walkthrough: {walk.title}</div>
            <ol class="list-decimal pl-4">
              <For each={walk.steps}>
                {(step) => (
                  <li>
                    {/* aislop-ignore-next-line jsx-a11y/anchor-is-valid -- Source links navigate inside the reader through onOpen. */}
                    <a
                      href="#"
                      class="thr-link text-primary-text"
                      onClick={(event) => {
                        event.preventDefault();
                        props.onOpen({ path: step.path, line: step.l1, end: step.l2 });
                      }}
                    >
                      {step.title}
                    </a>{' '}
                    <span class="text-foreground">{step.body}</span>
                  </li>
                )}
              </For>
            </ol>
          </div>
        )}
      </For>
    </>
  );
}
