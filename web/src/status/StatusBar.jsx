import { Show } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { SelectionBar } from '../editor/SelectionBar.jsx';
import { VimStatus } from '../editor/VimStatus.jsx';
import { LspMenu } from '../lsp/LspMenu.jsx';
import { Metrics } from './Metrics.jsx';
import { StatusActions } from './StatusActions.jsx';
import { fmtBytes, imageStatus } from './logic.js';
export function StatusBar() {
  const editor = useEditor();
  return (
    <footer
      id="status"
      class="@container flex shrink-0 items-center gap-2 whitespace-nowrap border-t bg-sidebar px-2 py-1 font-mono text-xs text-muted-foreground [&:has(#footer-sel:not([hidden]))]:border-primary"
    >
      <StatusActions />
      <span id="editor-vim-root" class="contents">
        <VimStatus />
      </span>
      <span id="st-size" class="hidden @3xl:inline">
        {editor.active() ? fmtBytes(editor.active().size) : ''}
      </span>
      <span id="st-pos" class="min-w-0 truncate">
        {editor.store.state.workspace.note || imageStatus(editor.active())}
      </span>
      <SelectionBar />
      <span id="editor-cursor-root" class="contents">
        <Show when={editor.active() && !editor.active().isImage}>
          <span>
            Ln {editor.active().cur}, Col {(editor.active().col || 0) + 1}
          </span>
        </Show>
      </span>
      <span id="status-spacer" class="min-w-0 flex-1" />
      <LspMenu />
      <Metrics />
    </footer>
  );
}
