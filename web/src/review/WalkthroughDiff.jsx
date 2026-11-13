import { For, onCleanup } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { activeBlock } from './logic.js';
import { WalkthroughFile } from './WalkthroughFile.jsx';
// Scrolling the diff marks the file under the sticky header as active in the file list.
export function WalkthroughDiff(props) {
  const editor = useEditor();
  const review = editor.review;
  const blocks = new Map();
  let pane;
  let frame = 0;
  let seenTarget = review.state.target.sequence;
  let revealedAt = 0;
  onCleanup(() => cancelAnimationFrame(frame));
  function syncActive() {
    frame = 0;
    const anchor = pane.getBoundingClientRect().top + 70;
    const paths = props.files.map((file) => file.path);
    const tops = paths.map((path) => blocks.get(path)?.getBoundingClientRect().top ?? Infinity);
    editor.actions.setActiveWalkthroughFile(paths[activeBlock(tops, anchor)]);
  }
  function onScroll() {
    // A requested reveal scrolls smoothly; let it land before tracking the user again.
    if (review.state.target.sequence !== seenTarget) {
      seenTarget = review.state.target.sequence;
      revealedAt = performance.now();
    }
    if (performance.now() - revealedAt < 800 || frame) return;
    frame = requestAnimationFrame(syncActive);
  }
  return (
    <section
      id="review-diff-pane"
      ref={pane}
      class="relative h-full min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain p-3"
      onScroll={onScroll}
    >
      <For each={props.files}>
        {(file) => (
          <div ref={(element) => blocks.set(file.path, element)}>
            <WalkthroughFile file={file} />
          </div>
        )}
      </For>
    </section>
  );
}
