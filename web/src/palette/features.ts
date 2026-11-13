import type { EditorStore } from '../editor/store.ts';
import type { DocTab } from '../editor/types.ts';
import type { ThemeStore } from '../lib/theme.ts';
import { listThemes } from '../lib/theme.ts';
import { withKeys } from '../lib/keyboard.ts';
import { copyRich, copyText } from '../lib/clipboard.ts';
export function registerFeatureCommands(editor: EditorStore, theme?: ThemeStore): () => void {
  const actions = editor.actions;
  const document = editor.active;
  const command = (name: string, run: () => unknown) => ({ name, run });
  const selection = () => editor.ui.selection;
  const wholeFile = (document: Pick<DocTab, 'name' | 'total'>) =>
    `Copied ${document.name} (${document.total} lines)`;
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
      const current = document();
      if (current) {
        await actions.showFilesPanel();
        await actions.revealFile(current.path);
      }
    }),
    command('Toggle Word Wrap', () => actions.toggleWrap()),
    command('Toggle Markdown / Table Preview', () => {
      const current = document();
      if (current) actions.togglePreview(current, current.cur);
    }),
    command('Toggle Sidebar', () => actions.togglePanel('left')),
    command('Select Theme…', () => actions.openPalette('theme')),
    command('Next Theme', () => {
      const themes = listThemes();
      const index = themes.findIndex((item) => item.id === theme?.current());
      const next = themes[(index + 1) % themes.length];
      if (next) theme?.setTheme(next.id);
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
    command(withKeys('File: Copy Source Code ({Mod+C})'), () => {
      const info = selection();
      if (info?.text) void copyText(info.text, 'Copied source code');
      else void actions.copyFile(wholeFile);
    }),
    command('File: Copy Raw Markdown', () => {
      const info = selection();
      if (info?.rawMarkdown) void copyText(info.rawMarkdown, 'Copied raw Markdown');
      else void actions.copyFile(wholeFile);
    }),
    command('File: Copy Formatted Text (Markdown Preview)', () => {
      const info = selection();
      if (info?.isMarkdownPreview)
        void copyRich(info.text, info.html || '', 'Copied formatted text');
      else void actions.copyFile((document: Pick<DocTab, 'name'>) => `Copied ${document.name}`);
    }),
    command('File: Copy Relative Path', () => {
      const current = document();
      if (current) void copyText(current.path, `Copied ${current.path}`);
    }),
    command(withKeys('Preferences: Open Settings (UI) ({Mod+,})'), () =>
      actions.openSettings('ui'),
    ),
    command('Preferences: Open Settings (JSON)', () => actions.openSettings('json')),
    command('Threads: Show All', () => actions.showThreads()),
    command(withKeys('Threads: Start New Thread ({Alt+T} on a selection)'), () =>
      actions.newThread(null),
    ),
    command('Threads: Delete Current Thread', () => actions.deleteThread()),
    command('Git: Open Pull Request…', () => actions.openPalette('openpr', '')),
    command('Keyboard Shortcuts', () => actions.showHelp()),
  ];
  return editor.palette.commands.register(commands);
}
