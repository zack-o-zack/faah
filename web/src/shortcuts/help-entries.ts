/** One section of the keyboard shortcut sheet: a heading and its key rows. */
export interface SheetSection {
  title: string;
  items: [string[], string][];
}

/** The Standard tab of the keyboard shortcut sheet, grouped by what the keys act on. */
export const STANDARD_SHEET_SECTIONS: SheetSection[] = [
  {
    title: 'General',
    items: [
      [['Mod+,'], 'Open settings'],
      [['Mod+K'], 'Quick search / palette'],
      [['Mod+P'], 'Go to file'],
      [['Mod+Shift+P'], 'Command palette'],
      [['Mod+Shift+O'], 'Go to symbol'],
      [['Mod+Shift+F'], 'Search in files'],
      [['Mod+Shift+R'], 'Refresh workspace'],
      [['Esc'], 'Dismiss'],
    ],
  },
  {
    title: 'Editor',
    items: [
      [['Mod+F'], 'Find in file'],
      [['Enter', 'Shift+Enter'], 'Next / previous match'],
      [['Mod+E'], 'Toggle edit mode'],
      [['Mod+S'], 'Save file (in edit mode)'],
      [['Mod+G'], 'Go to line'],
      [['Alt+Z'], 'Toggle word wrap'],
      [['Alt+M'], 'Toggle Markdown / table preview'],
      [['Mod+Home|Mod+Up', 'Mod+End|Mod+Down'], 'Top / bottom of file'],
      [['Home|Mod+Left', 'End|Mod+Right'], 'Start / end of line'],
      [['Left', 'Right'], 'Move caret along the line'],
    ],
  },
  {
    title: 'Code',
    items: [
      [['F12', 'Mod+Click'], 'Go to definition'],
      [['Shift+F12'], 'Find all references'],
      [['Alt+Shift+H'], 'Call trail (callers / callees)'],
      [['Shift+F1'], 'Show symbol documentation'],
      [['Alt+Left', 'Alt+Right'], 'Navigate back / forward'],
    ],
  },
  {
    title: 'Diff',
    items: [
      [['Mod+D'], 'Toggle diff view (git)'],
      [['[c', ']c'], 'Previous / next diff hunk'],
      [['[f', ']f'], 'Previous / next changed file'],
    ],
  },
  {
    title: 'Tabs and panels',
    items: [
      [['Mod+B'], 'Toggle sidebar'],
      [['Mod+J'], 'Toggle right sidebar / inspector'],
      [['Alt+W'], 'Close tab'],
      [['Alt+Shift+T'], 'Reopen closed tab'],
      [['Ctrl+Tab'], 'Next tab'],
      [['Alt+1…9'], 'Select tab'],
    ],
  },
  {
    title: 'Selection',
    items: [
      [['Double click'], 'Highlight all occurrences'],
      [['Mod+A'], 'Select whole file'],
      [['Mod+C'], 'Copy selection (source / formatted text)'],
      [['Alt+C', 'Alt+A'], 'Copy selection ref / with context'],
      [['Alt+U'], 'Find usages of selection'],
      [['Alt+E'], 'Edit selection inline'],
      [['Alt+T'], 'Start a thread on the selection'],
      [['Alt+X'], 'Explain the selection'],
      [['Right click'], 'Selection actions at the pointer'],
    ],
  },
];
