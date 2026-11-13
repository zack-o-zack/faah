import { Minimap } from './Minimap.jsx';
import { createEffect, on, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useEditor } from './context.jsx';
import { Viewport } from './Viewport.jsx';
import { EditView } from './EditView.jsx';
import { HoverCard } from './HoverCard.jsx';
import { FindBar } from './FindBar.jsx';
import { TabStrip } from './TabStrip.jsx';
import { FileActions } from './FileActions.jsx';
import { EditorShortcuts } from './EditorShortcuts.jsx';
import { EditorMeasure } from './EditorMeasure.tsx';

export function EditorShell() {
  const editor = useEditor();
  createEffect(
    on(
      () => [
        editor.active()?.isEditing,
        editor.settings.preferences().vim,
        editor.ui.vim.mode,
        editor.settings.preferences().wrap,
      ],
      () => {
        document.body.classList.toggle('word-wrap', editor.settings.preferences().wrap);
        document.body.classList.toggle('editing-file', !!editor.active()?.isEditing);
        document.body.classList.toggle('vim-mode-enabled', editor.settings.preferences().vim);
        document.body.classList.toggle(
          'vim-normal-caret',
          editor.settings.preferences().vim && editor.ui.vim.mode === 'NORMAL',
        );
      },
    ),
  );
  onMount(() => {
    const beforeUnload = (event) => {
      if (!editor.store.state.documents.tabs.some((tab) => tab.dirty)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    onCleanup(() => window.removeEventListener('beforeunload', beforeUnload));
  });
  return (
    <>
      <Portal mount={document.getElementById('editor-tabs-root')}>
        <TabStrip>
          <FileActions />
        </TabStrip>
      </Portal>
      <Portal mount={document.getElementById('editor-source-root')}>
        <Viewport />
        <EditView />
        <FindBar />
        <HoverCard />
      </Portal>
      <Portal mount={document.getElementById('editor-minimap-root')}>
        <Minimap />
      </Portal>
      <EditorShortcuts />
      <EditorMeasure
        fontSize={editor.settings.preferences().fontSize}
        fontFamily={editor.settings.preferences().fontFamily}
        lineHeight={editor.settings.preferences().lineHeight}
        onMeasure={(geometry) => {
          editor.setGeometry(geometry);
          editor.store.actions.setGeometry(geometry);
        }}
      />
    </>
  );
}
