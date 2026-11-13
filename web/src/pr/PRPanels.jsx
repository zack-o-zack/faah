import { Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { PRBar } from './PRBar.jsx';
import { CommentsPanel } from './CommentsPanel.jsx';
// A PR session's footer and comments show with the overview.
export function PRPanels() {
  const editor = useEditor();
  return (
    <Show when={editor.pr.available() && editor.review.state.mode === 'review'}>
      <PRBar />
      <CommentsPanel />
    </Show>
  );
}
