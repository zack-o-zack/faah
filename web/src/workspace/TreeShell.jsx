import { Portal } from 'solid-js/web';
import { TreeToolbar } from './TreeToolbar.jsx';
import { TreeScope } from './TreeScope.jsx';
import { Tree } from './Tree.jsx';
import { NewItemDialog } from './NewItemDialog.jsx';
export function TreeShell() {
  return (
    <>
      <Portal mount={document.getElementById('tree-toolbar-root')}>
        <TreeToolbar />
      </Portal>
      <Portal mount={document.getElementById('tree-scope-root')}>
        <TreeScope />
      </Portal>
      <Portal mount={document.getElementById('tree-root')}>
        <Tree />
      </Portal>
      <NewItemDialog />
    </>
  );
}
