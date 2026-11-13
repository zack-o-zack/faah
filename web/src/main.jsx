import { Palette } from './palette/Palette.jsx';
import { SearchShell } from './search/SearchShell.jsx';
import { GitShell } from './git/GitShell.jsx';
import { getOwner, onMount, runWithOwner } from 'solid-js';
import { render } from 'solid-js/web';
import { AppProvider, useApp } from './app/context.jsx';
import { ThemeProvider, useTheme } from './lib/theme-context.jsx';
import { Toaster } from './lib/toast.jsx';
import { bindLegacyEditor, attachLegacyDOM } from './app/legacy-bridge.js';
import { createEditorStore } from './editor/store.js';
import { EditorProvider } from './editor/context.jsx';
import { TreeShell } from './workspace/TreeShell.jsx';
import { ViewerShell } from './viewers/ViewerShell.jsx';
import { EditorShell } from './editor/EditorShell.jsx';

function App() {
  const theme = useTheme();
  const editorStore = createEditorStore(useApp(), { theme });
  const owner = getOwner();
  bindLegacyEditor(editorStore, useTheme());
  onMount(async () => {
    attachLegacyDOM();
    const { initLegacy } = await import('./main.js');
    runWithOwner(owner, initLegacy);
  });
  return (
    <EditorProvider value={editorStore}>
      <Palette />
      <SearchShell />
      <TreeShell />
      <GitShell />
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
