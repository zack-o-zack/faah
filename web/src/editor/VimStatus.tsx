import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { VimHelp } from './VimHelp.tsx';
import { useEditor } from './context.tsx';
export function VimStatus(): JSX.Element {
  const editor = useEditor();
  return (
    <>
      <button
        id="st-vim"
        class="btn font-mono"
        data-control="status-vim-chip"
        data-variant={editor.ui.vim.mode === 'NORMAL' ? 'primary' : 'secondary'}
        data-size="xs"
        hidden={!editor.settings.preferences().vim}
        onClick={editor.actions.showVimHelp}
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
