import { useEditor } from '../editor/context.jsx';
import { TreeToolbar } from '../workspace/TreeToolbar.jsx';
import { TreeScope } from '../workspace/TreeScope.jsx';
import { Tree } from '../workspace/Tree.jsx';
import { GitPanel } from '../git/GitPanel.jsx';
import { Unpushed } from '../git/Unpushed.jsx';
import { SidebarFooter } from './SidebarFooter.jsx';
export function Sidebar() {
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
      <SidebarFooter />
    </aside>
  );
}
