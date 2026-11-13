import { SplitHandle } from '../lib/SplitHandle.jsx';
import { Portal } from 'solid-js/web';
import { useEditor } from '../editor/context.jsx';
import { InspectorToolbar } from './InspectorToolbar.jsx';
import { References } from './References.jsx';
import { Symbols } from './Symbols.jsx';
import { Calls } from './Calls.jsx';
import { Search } from '../search/Search.jsx';
import { LspMenu } from '../lsp/LspMenu.jsx';
export function InspectorShell() {
  const editor = useEditor();
  return (
    <>
      <Portal mount={document.getElementById('inspector-toggle-root')}>
        <button
          id="btn-open-right"
          class="btn"
          aria-label="Toggle inspector"
          aria-pressed={editor.store.state.layout.right}
          onClick={() => editor.actions.togglePanel('right')}
        >
          Inspector
        </button>
      </Portal>
      <Portal mount={document.getElementById('right-resizer-root')}>
        <div
          class="w-1 shrink-0 [&_.split-handle]:h-full"
          hidden={!editor.store.state.layout.right}
        >
          <SplitHandle
            label="Inspector width"
            value={-editor.store.state.layout.rightWidth}
            min={-700}
            max={-200}
            onChange={(value) => editor.actions.setPanelWidth('right', -value)}
          />
        </div>
      </Portal>
      <Portal mount={document.getElementById('inspector-head-root')}>
        <InspectorToolbar />
      </Portal>
      <Portal mount={document.getElementById('inspector-panes-root')}>
        <section
          id="pane-right-refs"
          class="flex min-h-0 flex-1 flex-col"
          hidden={editor.store.state.layout.inspector !== 'refs'}
        >
          <References />
        </section>
        <section
          id="pane-right-symbols"
          class="flex min-h-0 flex-1 flex-col"
          hidden={editor.store.state.layout.inspector !== 'symbols'}
        >
          <Symbols />
        </section>
        <section
          id="pane-right-calls"
          class="flex min-h-0 flex-1 flex-col"
          hidden={editor.store.state.layout.inspector !== 'calls'}
        >
          <Calls />
        </section>
        <section
          id="pane-right-search"
          class="flex min-h-0 flex-1 flex-col"
          hidden={editor.store.state.layout.inspector !== 'search'}
        >
          <Search />
        </section>
      </Portal>
      <Portal mount={document.getElementById('lsp-root')}>
        <LspMenu />
      </Portal>
    </>
  );
}
