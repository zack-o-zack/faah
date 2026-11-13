import { Portal } from 'solid-js/web';
import { useEditor } from '../editor/context.jsx';
import { Sidebar } from './Sidebar.jsx';
import { RightSidebar } from './RightSidebar.jsx';
import { PanelHandle } from './PanelHandle.jsx';
import { StatusBar } from '../status/StatusBar.jsx';
import { NewItemDialog } from '../workspace/NewItemDialog.jsx';
export function LayoutShell() {
  const editor = useEditor();
  return (
    <>
      <Portal
        ref={(element) => {
          element.style.display = 'contents';
        }}
        mount={document.getElementById('sidebar-root')}
      >
        <Sidebar />
        <PanelHandle panel="left" label="Sidebar width" />
      </Portal>
      <Portal
        ref={(element) => {
          element.style.display = 'contents';
        }}
        mount={document.getElementById('right-sidebar-root')}
      >
        <PanelHandle panel="right" label="Inspector width" />
        <RightSidebar />
      </Portal>
      <Portal
        ref={(element) => {
          element.style.display = 'contents';
        }}
        mount={document.getElementById('threads-resizer-root')}
      >
        <PanelHandle panel="threads" label="Threads width" />
      </Portal>
      <Portal
        ref={(element) => {
          element.style.display = 'contents';
        }}
        mount={document.getElementById('status-root')}
      >
        <StatusBar />
      </Portal>
      <Portal
        ref={(element) => {
          element.style.display = 'contents';
        }}
        mount={document.getElementById('inspector-toggle-root')}
      >
        <button
          id="btn-open-right"
          class="btn"
          aria-label="Toggle inspector"
          aria-pressed={editor.store.state.layout.right}
          onClick={() => editor.actions.togglePanel('right')}
        >
          <span class="icon-[lucide--panel-right] size-3.5" />
        </button>
      </Portal>
      <NewItemDialog />
    </>
  );
}
