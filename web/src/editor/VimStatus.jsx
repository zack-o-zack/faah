import { Show } from 'solid-js';
import { VimHelp } from './VimHelp.jsx';
import { useEditor } from './context.jsx';
export function VimStatus() {
  const editor = useEditor();
  return (
    <>
      <button
        id="st-vim"
        class="btn font-mono"
        hidden={!editor.ui.vimEnabled}
        onClick={() => editor.setUI('vimHelp', true)}
      >
        {editor.ui.vim.mode === 'VISUAL_LINE' ? 'V-LINE' : editor.ui.vim.mode} {editor.ui.vim.count}
        {editor.ui.vim.pending}
      </button>
      <Show when={editor.ui.vimHelp}>
        <VimHelp />
      </Show>
    </>
  );
}
