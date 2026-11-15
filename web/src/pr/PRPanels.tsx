import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { PRBar } from './PRBar.tsx';
import { CommentsPanel } from './CommentsPanel.tsx';
import { SplitHandle } from '../lib/SplitHandle.tsx';

// A PR session's footer and comments show with the review.
export function PRPanels(): JSX.Element {
  const editor = useEditor();
  let panel: HTMLDivElement | undefined;
  // CSS owns the bounds. Read only the panel being resized so a capped preferred size
  // cannot cause a jump or a dead zone when the pointer changes direction.
  const renderedHeight = () =>
    panel?.getBoundingClientRect().height ?? editor.pr.state.panel.height;
  return (
    <Show when={editor.pr.available() && editor.review.state.mode === 'review'}>
      <div
        id="pr-footer"
        class="[body:not(.in-review-mode)_&]:hidden! relative flex min-h-0 shrink flex-col border-t border-border bg-sidebar"
      >
        <SplitHandle
          vertical
          reverse
          label="Comments panel height"
          disabled={editor.pr.state.panel.collapsed}
          value={editor.pr.state.panel.height}
          readValue={renderedHeight}
          min={80}
          onChange={editor.actions.setPRPanelHeight}
          onChangeEnd={editor.actions.setPRPanelHeight}
          class="absolute inset-x-0 -top-px z-30"
        />
        <PRBar />
        <CommentsPanel ref={(element) => (panel = element)} />
      </div>
    </Show>
  );
}
