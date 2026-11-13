import { createEffect, For, onCleanup } from 'solid-js';
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
      class="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4"
      onScroll={() => {
        following = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 60;
      }}
    >
      <For each={props.thread?.turns}>
        {(turn) => <ThreadTurn turn={turn} thread={props.thread} />}
      </For>
    </div>
  );
}
