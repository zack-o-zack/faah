import { createEffect, For, onCleanup, Show } from 'solid-js';
import { ThreadTurn } from './ThreadTurn.jsx';
export function ThreadTranscript(props) {
  let viewport, frame;
  let following = true;
  createEffect(() => {
    props.thread?.id;
    props.thread?.turns?.length;
    props.thread?.turns?.at(-1)?.reply;
    props.thread?.turns?.at(-1)?.tools?.length;
    if (following)
      frame = requestAnimationFrame(() => {
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
