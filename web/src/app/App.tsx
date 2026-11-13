import { createEffect, onCleanup, onMount, type Component } from 'solid-js';
import { useApp } from './context.jsx';
import { useTheme } from '../lib/theme-context.jsx';
import { Toaster } from '../lib/toast.jsx';
import { createEditorStore } from '../editor/store.js';
import { EditorProvider, useEditor } from '../editor/context.jsx';
import { EditorShortcuts } from '../editor/EditorShortcuts.jsx';
import { EditorMeasure, type EditorGeometry } from '../editor/EditorMeasure.tsx';
import { Palette } from '../palette/Palette.jsx';
import { NewItemDialog } from '../workspace/NewItemDialog.jsx';
import { ReturnPill } from '../review/ReturnPill.jsx';
import { MergeDialog } from '../pr/MergeDialog.jsx';
import { ForgeConnectDialog } from '../pr/ForgeConnectDialog.jsx';
import { ComposerDock } from '../pr/ComposerDock.jsx';
import { SettingsProvider } from '../settings/context.ts';
import { SettingsDialog } from '../settings/SettingsDialog.tsx';
import { PreferenceStyles } from '../settings/PreferenceStyles.tsx';
import { preferenceClasses, type Preferences } from '../settings/logic.ts';
import type { SettingsStore } from '../settings/store.ts';
import { GlobalShortcuts } from '../shortcuts/GlobalShortcuts.tsx';
import { HelpSheet } from '../shortcuts/HelpSheet.tsx';
import { AppShell } from './AppShell.tsx';
import { bootWorkspace, type BootEditor } from './boot.ts';

interface AppDocument {
  path: string;
  diffAvailable?: boolean;
  dirty?: boolean;
  isEditing?: boolean;
}

/** What the app root reads from the editor store, besides starting the workspace. */
interface AppEditor extends BootEditor {
  active: () => AppDocument | null;
  settings: SettingsStore;
  store: {
    state: {
      workspace: BootEditor['store']['state']['workspace'];
      layout: { left: boolean; right: boolean; threads: boolean };
      documents: { tabs: AppDocument[] };
    };
    actions: BootEditor['store']['actions'] & {
      setGeometry: (geometry: EditorGeometry) => void;
    };
  };
  review: { state: { mode: 'code' | 'review' } };
  ui: { vim: { mode: string } };
  setGeometry: (geometry: EditorGeometry) => void;
  actions: BootEditor['actions'] & { showVimHelp: () => void };
}

/** Classes on <body> that the stylesheet keys layout, editor modes and preferences on. */
function bodyClasses(editor: AppEditor, prefs: Preferences): Record<string, boolean> {
  const layout = editor.store.state.layout;
  return {
    ...preferenceClasses(prefs),
    'side-hidden': !layout.left,
    'right-hidden': !layout.right,
    'threads-hidden': !layout.threads,
    'in-review-mode': editor.review.state.mode === 'review',
    'word-wrap': prefs.wrap,
    'editing-file': !!editor.active()?.isEditing,
    'vim-mode-enabled': prefs.vim,
    'vim-normal-caret': prefs.vim && editor.ui.vim.mode === 'NORMAL',
  };
}

/** Starts the workspace and renders the page with its dialogs. */
const AppRoot: Component = () => {
  const editor: AppEditor = useEditor();
  const prefs = (): Preferences => editor.settings.preferences();
  createEffect(() => {
    for (const [name, on] of Object.entries(bodyClasses(editor, prefs())))
      document.body.classList.toggle(name, on);
  });
  createEffect(() => {
    const name = editor.store.state.workspace.meta?.name;
    document.title = name ? name + ' - faah' : 'faah';
  });
  onMount(() => {
    onCleanup(bootWorkspace(editor));
    // Leaving with unsaved edits asks first.
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (!editor.store.state.documents.tabs.some((tab) => tab.dirty)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    onCleanup(() => window.removeEventListener('beforeunload', beforeUnload));
  });
  const measured = (geometry: EditorGeometry): void => {
    editor.setGeometry(geometry);
    editor.store.actions.setGeometry(geometry);
  };
  return (
    <>
      <SettingsProvider value={editor.settings}>
        <PreferenceStyles />
        <SettingsDialog onVimHelp={editor.actions.showVimHelp} />
      </SettingsProvider>
      <GlobalShortcuts />
      <EditorShortcuts />
      <EditorMeasure
        fontSize={prefs().fontSize}
        fontFamily={prefs().fontFamily}
        lineHeight={prefs().lineHeight}
        onMeasure={measured}
      />
      <AppShell />
      <HelpSheet />
      <Palette />
      <NewItemDialog />
      <ComposerDock />
      <MergeDialog />
      <ForgeConnectDialog />
      <ReturnPill />
      <Toaster />
    </>
  );
};

/** Creates the editor store for the page. */
export const App: Component = () => (
  <EditorProvider value={createEditorStore(useApp(), { theme: useTheme() })}>
    <AppRoot />
  </EditorProvider>
);
