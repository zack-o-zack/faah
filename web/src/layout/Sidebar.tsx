import type { JSX } from 'solid-js';
import { useEditor } from '../editor/context.tsx';
import { TreeToolbar } from '../workspace/TreeToolbar.tsx';
import { TreeScope } from '../workspace/TreeScope.tsx';
import { Tree } from '../workspace/Tree.tsx';
import { GitPanel } from '../git/GitPanel.tsx';
import { Unpushed } from '../git/Unpushed.tsx';
export function Sidebar(): JSX.Element {
  const editor = useEditor();
  return (
    <aside
      id="side"
      hidden={!editor.store.state.layout.left}
      style={{ width: editor.store.state.layout.leftWidth + 'px' }}
      class="flex shrink-0 flex-col overflow-hidden border-r bg-sidebar text-sidebar-foreground"
    >
      <TreeToolbar />
      <TreeScope />
      <Tree />
      <Unpushed />
      <GitPanel />
    </aside>
  );
}
