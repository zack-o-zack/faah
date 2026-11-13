import type { WalkthroughFile as File } from './types.ts';

interface WalkthroughDiffProps {
  files: File[];
}
import type { JSX } from 'solid-js';
import { For, onCleanup } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { activeBlock } from './logic.ts';
import { WalkthroughFile } from './WalkthroughFile.tsx';
// Scrolling the diff marks the file under the sticky header as active in the file list.
export function WalkthroughDiff(props: WalkthroughDiffProps): JSX.Element {
  const editor = useEditor();
  const review = editor.review;
  const blocks = new Map<string, HTMLDivElement>();
  let pane: HTMLElement | undefined;
  let frame = 0;
  let seenTarget = review.state.target.sequence;
  let revealedAt = 0;
  onCleanup(() => cancelAnimationFrame(frame));
  function syncActive(): JSX.Element {
    frame = 0;
    if (!pane) return;
    const anchor = pane.getBoundingClientRect().top + 70;
    const paths = props.files.map((file) => file.path);
    const tops = paths.map((path) => blocks.get(path)?.getBoundingClientRect().top ?? Infinity);
    editor.actions.setActiveWalkthroughFile(paths[activeBlock(tops, anchor)] || '');
  }
  function onScroll(): JSX.Element {
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
