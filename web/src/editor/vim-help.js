export const VIM_SHORTCUT_SECTIONS = [
  {
    title: 'Modes & Motions',
    items: [
      [['h', 'j', 'k', 'l'], 'Move left, down, up, right'],
      [['w', 'b'], 'Next / previous word boundary'],
      [['0', '^', '$'], 'Start of line / first non-blank / end of line'],
      [['gg', 'G'], 'First line / last line (or [count]gg / [count]G)'],
      [['Ctrl+d', 'Ctrl+u'], 'Scroll half-page down / up'],
      [['Ctrl+f', 'Ctrl+b'], 'Scroll full-page down / up'],
      [['zz', 'zt', 'zb'], 'Center line / line to top / line to bottom'],
      [['H', 'M', 'L'], 'Move to top, middle, bottom visible line'],
    ],
  },
  {
    title: 'Code Intelligence & LSP',
    items: [
      [['gd'], 'Go to Definition (replaces F12)'],
      [['gr'], 'Find References across workspace (replaces Shift+F12)'],
      [['K'], 'Show hover documentation & signatures'],
      [['gh'], 'Call Trail (callers / callees)'],
      [['Ctrl+o', 'Ctrl+i'], 'Jump back / forward in navigation history'],
    ],
  },
  {
    title: 'Search & Occurrences',
    items: [
      [['/'], 'Find in file (forward)'],
      [['?'], 'Find in file (backward)'],
      [['n', 'N'], 'Next / previous match'],
      [['*', '#'], 'Search current word under cursor forward / backward'],
      [['Esc'], 'Clear highlights, search, and occurrences'],
    ],
  },
  {
    title: 'Visual Mode & AI Agent Actions',
    items: [
      [['v'], 'Character-wise visual selection'],
      [['V'], 'Line-wise visual selection'],
      [['e', 'c'], 'Edit selection inline with AI coding agent'],
      [['y'], 'Yank (copy) code to clipboard'],
      [['Y'], 'Yank reference (file:line-range)'],
      [['u'], 'Find usages of selected symbol'],
      [['Esc'], 'Cancel selection and return to Normal mode'],
    ],
  },
  {
    title: 'Tabs & Commands',
    items: [
      [['gt', 'gT'], 'Next tab / previous tab'],
      [['[N]gt'], 'Switch to tab N'],
      [[':'], 'Open Command Palette'],
    ],
  },
];
