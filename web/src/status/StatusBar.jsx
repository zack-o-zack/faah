import { onCleanup, onMount } from 'solid-js';
import { useEditor } from '../editor/context.jsx';
import { SelectionBar } from '../editor/SelectionBar.jsx';
import { VimStatus } from '../editor/VimStatus.jsx';
import { LspMenu } from '../lsp/LspMenu.jsx';
import { Metrics } from './Metrics.jsx';
import { StatusActions } from './StatusActions.jsx';
import { fmtBytes, statusMessage } from './logic.ts';
export function StatusBar() {
  const editor = useEditor();
  let status, spacer;
  onMount(() => {
    let level = 0;
    let frame;
    const apply = (value) => {
      for (let step = 1; step <= 6; step++) status.classList.toggle('fit-' + step, step <= value);
      return spacer.offsetWidth - (status.scrollWidth - status.clientWidth);
    };
    const fit = () => {
      let room = apply(level);
      while (level < 6 && room < 0) room = apply(++level);
      while (level > 0 && room >= 16) {
        room = apply(level - 1);
        if (room < 16) {
          apply(level);
          return;
        }
        level--;
      }
    };
    const resize = new ResizeObserver(fit);
    const mutation = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    resize.observe(status);
    mutation.observe(status, { childList: true, subtree: true, characterData: true });
    document.fonts?.ready.then(fit);
    onCleanup(() => {
      resize.disconnect();
      mutation.disconnect();
      cancelAnimationFrame(frame);
    });
  });
  return (
    <footer
      ref={status}
      classList={{ selecting: !!editor.ui.selection }}
      id="status"
      class="flex shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border-t bg-sidebar px-2 py-1 font-mono text-xs text-muted-foreground select-none [&>*]:shrink-0 [&.selecting]:border-primary [&.fit-1_kbd]:hidden [&.fit-2_#st-size]:hidden [&.fit-3_.metric-label]:hidden [&.fit-4_[data-action=wrap]]:hidden [&.fit-4_[data-action=help]]:hidden [&.fit-4_.sel-chip]:hidden [&.fit-4_#sel-stats]:hidden! [&.fit-5_#st-lang]:hidden [&.fit-6_#st-pos]:hidden"
    >
      <StatusActions />
      <SelectionBar />
      <span class="status-sep h-3 w-px shrink-0 bg-border [#status.selecting_#footer-actions+&]:hidden" />
      <span id="editor-vim-root" class="contents">
        <VimStatus />
      </span>
      <span id="st-size" class="[#status.selecting_&]:hidden">
        {editor.active() ? fmtBytes(editor.active().size) : ''}
      </span>
      <span
        id="st-pos"
        role="status"
        class="empty:hidden"
        classList={{ 'text-destructive': !!editor.store.state.workspace.error }}
        title={editor.store.state.workspace.error || ''}
      >
        {statusMessage(editor.store.state.workspace, editor.active())}
      </span>
      <span id="status-spacer" ref={spacer} class="flex-1" />
      <LspMenu />
      <span id="sel-stats" class="hidden [#status.selecting_&]:inline-flex">
        {editor.ui.selection
          ? `${editor.ui.selection.l2 - editor.ui.selection.l1 + 1} lines · ${editor.ui.selection.text.length} chars`
          : ''}
      </span>
      <span class="status-sep h-3 w-px shrink-0 bg-border [#status.selecting_#footer-actions+&]:hidden" />
      <Metrics />
    </footer>
  );
}
