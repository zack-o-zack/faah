import { listThemes } from '../lib/theme.js';
export function registerFeatureCommands(editor, theme) {
  const actions = editor.actions;
  const document = editor.active;
  const command = (name, run) => ({ name, run });
  const commands = [
    command('File: New File…', () => actions.openNewItem('file')),
    command('File: New Folder…', () => actions.openNewItem('dir')),
    command('File: Edit Current File', () =>
      document()?.isEditing ? actions.exitEditMode() : actions.enterEditMode(),
    ),
    command('File: Save File', () => actions.saveActiveFile()),
    command('Go to File…', () => actions.openPalette('file')),
    command('Go to Symbol in File…', () => actions.openPalette('symbol')),
    command('Go to Line…', () => actions.openPalette('line')),
    command('Search in Files', () => actions.showRightInspector('search')),
    command('Find in Current File', () => actions.openFind()),
    command('Show Symbol Documentation (Shift+F1)', () => actions.showHoverAtCaret()),
    command('Go to Definition', () => actions.gotoDefinition()),
    command('Find All References (Right Panel)', () => actions.findReferences()),
    command('Show Call Trail: Callers / Callees', () => actions.showCalls()),
    command('Language Servers: Setup & Manage…', () => actions.openLspMenu()),
    command('Set Up Language Server…', () => actions.openLspMenu()),
    command('Language Servers: Start All', () => actions.startAllLsp()),
    command('Language Servers: Stop All', () => actions.stopAllLsp()),
    command('Toggle Right Sidebar / Inspector', () => actions.togglePanel('right')),
    command('Show File Symbols (Right Panel)', () => actions.showRightInspector('symbols')),
    command('Reveal Active File in Explorer', async () => {
      if (document()) {
        await actions.showFilesPanel();
        await actions.revealFile(document().path);
      }
    }),
    command('Toggle Word Wrap', () => actions.toggleWrap()),
    command('Toggle Markdown / Table Preview', () => {
      if (document()) actions.togglePreview(document(), document().cur);
    }),
    command('Toggle Sidebar', () => actions.togglePanel('left')),
    command('Select Theme…', () => actions.openPalette('theme')),
    command('Next Theme', () => {
      const themes = listThemes();
      const index = themes.findIndex((item) => item.id === theme?.current());
      theme?.setTheme(themes[(index + 1) % themes.length].id);
    }),
    command('Re-index Workspace', () => actions.reindexWorkspace()),
    command('Close Tab', () => actions.closeTabs([editor.store.state.documents.active])),
    command('Close All Tabs', () =>
      actions.closeTabs(editor.store.state.documents.tabs.map((_, index) => index)),
    ),
    command('Reopen Closed Tab', async () => {
      await actions.reopenDocument();
      actions.activateView();
    }),
    command('Preferences: Toggle Vim Keybindings', () =>
      actions.setVimEnabled(!editor.settings.preferences().vim),
    ),
    command('Help: Vim Keybindings Cheat Sheet', () => actions.showVimHelp()),
  ];
  return editor.palette.commands.register(commands);
}
