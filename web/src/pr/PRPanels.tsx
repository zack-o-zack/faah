import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { PRBar } from './PRBar.tsx';
import { CommentsPanel } from './CommentsPanel.tsx';
// A PR session's footer and comments show with the overview.
export function PRPanels(): JSX.Element {
  const editor = useEditor();
  return (
    <Show when={editor.pr.available() && editor.review.state.mode === 'review'}>
      <PRBar />
      <CommentsPanel />
    </Show>
  );
}
