import type { Thread, ThreadTurn as Turn } from './decode.ts';
interface ThreadTranscriptProps {
  thread?: Thread | null;
  id?: string;
  class?: string;
  empty?: JSX.Element;
  children?: (turn: Turn, index: Accessor<number>) => JSX.Element;
}
import type { JSX } from 'solid-js';
import { createEffect, For, onCleanup, Show, type Accessor } from 'solid-js';
import { ThreadTurn } from './ThreadTurn.tsx';
export function ThreadTranscript(props: ThreadTranscriptProps): JSX.Element {
  let viewport: HTMLDivElement | undefined;
  let frame = 0;
  let following = true;
  createEffect(() => {
    void props.thread?.id;
    void props.thread?.turns?.length;
    void props.thread?.turns?.at(-1)?.reply;
    void props.thread?.turns?.at(-1)?.tools?.length;
    if (following)
      frame = requestAnimationFrame(() => {
        if (!viewport) return;
        viewport.scrollTop = viewport.scrollHeight;
      });
    onCleanup(() => cancelAnimationFrame(frame));
  });
  return (
    <div
      id={props.id}
      ref={viewport}
      class={props.class || 'flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4'}
      onScroll={() => {
        if (!viewport) return;
        following = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 60;
      }}
    >
      <For each={props.thread?.turns}>
        {(turn, index) =>
          props.children ? (
            // The index accessor passes through to the caller's render function unread.
            // eslint-disable-next-line solid/reactivity
            props.children(turn, index)
          ) : (
            <ThreadTurn turn={turn} thread={props.thread} />
          )
        }
      </For>
      <Show when={props.empty && !props.thread?.turns?.length}>
        <div data-ui="hint" class="empty text-muted-foreground">
          {props.empty}
        </div>
      </Show>
    </div>
  );
}
