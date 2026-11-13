import { ThreadsPanel, ThreadsToggle } from './threads/ThreadsPanel.jsx';
import { Portal } from 'solid-js/web';
import { LayoutShell } from './layout/LayoutShell.jsx';
import { Palette } from './palette/Palette.jsx';
import { createEffect, getOwner, onMount, runWithOwner } from 'solid-js';
import { render } from 'solid-js/web';
import { AppProvider, useApp } from './app/context.jsx';
import { ThemeProvider, useTheme } from './lib/theme-context.jsx';
import { Toaster } from './lib/toast.jsx';
import { bindLegacyEditor, attachLegacyDOM } from './app/legacy-bridge.js';
import { createEditorStore } from './editor/store.js';
import { EditorProvider } from './editor/context.jsx';
import { ViewerShell } from './viewers/ViewerShell.jsx';
import { EditorShell } from './editor/EditorShell.jsx';
import { ReviewView } from './review/ReviewView.jsx';
import { ReviewToggle } from './review/ReviewToggle.jsx';
import { ReturnPill } from './review/ReturnPill.jsx';

function App() {
  const theme = useTheme();
  const editorStore = createEditorStore(useApp(), { theme });
  const owner = getOwner();
  bindLegacyEditor(editorStore, useTheme());
  // The static shell still holds the editor area; the overview replaces it.
  createEffect(() => {
    const reviewing = editorStore.review.state.mode === 'review';
    document.body.classList.toggle('in-review-mode', reviewing);
    document.getElementById('editor').hidden = reviewing;
  });
  onMount(async () => {
    attachLegacyDOM();
    const { initLegacy } = await import('./main.js');
    runWithOwner(owner, initLegacy);
  });
  return (
    <EditorProvider value={editorStore}>
      <Palette />
      <LayoutShell />
      <Portal
        ref={(element) => {
          element.style.display = 'contents';
        }}
        mount={document.getElementById('threads-root')}
      >
        <ThreadsPanel />
      </Portal>
      <Portal
        ref={(element) => {
          element.style.display = 'contents';
        }}
        mount={document.getElementById('threads-toggle-root')}
      >
        <ThreadsToggle />
      </Portal>
      <Portal
        ref={(element) => {
          element.style.display = 'contents';
        }}
        mount={document.getElementById('review-toggle-root')}
      >
        <ReviewToggle />
      </Portal>
      <Portal
        ref={(element) => {
          element.style.display = 'contents';
        }}
        mount={document.getElementById('review-root')}
      >
        <ReviewView />
      </Portal>
      <ReturnPill />
      <EditorShell />
      <ViewerShell />
      <Toaster />
    </EditorProvider>
  );
}
render(
  () => (
    <AppProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </AppProvider>
  ),
  document.getElementById('solid-root'),
);
