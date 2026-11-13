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
import { PRPanels } from './pr/PRPanels.jsx';
import { MergeDialog } from './pr/MergeDialog.jsx';
import { ForgeConnectDialog } from './pr/ForgeConnectDialog.jsx';
import { ComposerDock } from './pr/ComposerDock.jsx';
import { SettingsProvider } from './settings/context.ts';
import { SettingsDialog } from './settings/SettingsDialog.tsx';
import { PreferenceStyles } from './settings/PreferenceStyles.tsx';

function App() {
  const theme = useTheme();
  const editorStore = createEditorStore(useApp(), { theme });
  const owner = getOwner();
  bindLegacyEditor(editorStore);
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
      <SettingsProvider value={editorStore.settings}>
        <PreferenceStyles />
        <SettingsDialog onVimHelp={editorStore.actions.showVimHelp} />
      </SettingsProvider>
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
      <Portal
        ref={(element) => {
          element.style.display = 'contents';
        }}
        mount={document.getElementById('pr-root')}
      >
        <PRPanels />
      </Portal>
      <ComposerDock />
      <MergeDialog />
      <ForgeConnectDialog />
      <ReturnPill />
      <EditorShell />
      <ViewerShell />
      <Toaster />
    </EditorProvider>
  );
}
// The theme follows the color theme setting; picking one saves it.
function SettingsThemeProvider(props) {
  const app = useApp();
  return (
    <ThemeProvider
      options={{
        configured: () => app.settings.preferences().colorTheme,
        save: (id) => void app.settings.actions.setSetting('workbench.colorTheme', id),
      }}
    >
      {props.children}
    </ThemeProvider>
  );
}
render(
  () => (
    <AppProvider>
      <SettingsThemeProvider>
        <App />
      </SettingsThemeProvider>
    </AppProvider>
  ),
  document.getElementById('solid-root'),
);
