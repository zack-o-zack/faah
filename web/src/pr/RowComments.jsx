import { For, Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { rowTarget, threadKey } from './logic.ts';
import { PRComposer } from './PRComposer.jsx';
/** A diff line's comment marker; it opens the line's thread in the comments panel. */
export function CommentMarker(props) {
  const editor = useEditor();
  const target = () => rowTarget(props.row);
  const count = () =>
    target() && editor.pr ? editor.pr.marker(props.path, target().side, target().line) : 0;
  return (
    <Show when={props.reviewable && count()}>
      <button
        type="button"
        class="inline-flex flex-none cursor-pointer items-center text-primary-text"
        title={`View ${count()} comment${count() === 1 ? '' : 's'}`}
        aria-label={`View ${count()} comment${count() === 1 ? '' : 's'}`}
        onClick={(event) => {
          event.stopPropagation();
          editor.actions.revealPRThread(
            'thread:' + threadKey(props.path, target().side, target().line),
          );
        }}
      >
        <span class="icon-[lucide--message-square] size-3 shrink-0" aria-hidden="true" />
      </button>
    </Show>
  );
}
/** Open draft composers for the given diff rows render beneath them. */
export function RowComposers(props) {
  const editor = useEditor();
  // Both halves of a context row target the same line: list its composers once.
  const composers = () => [
    ...new Set(
      props.rows.flatMap((row) => {
        const target = rowTarget(row);
        return target ? editor.pr.composersAt(props.path, target.side, target.line) : [];
      }),
    ),
  ];
  return (
    <Show when={composers().length}>
      <div class="flex flex-col gap-2 px-4 py-2">
        <For each={composers()}>{(composer) => <PRComposer composer={composer} />}</For>
      </div>
    </Show>
  );
}
