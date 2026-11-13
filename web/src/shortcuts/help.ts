import type { ShortcutHelp } from './registry.ts';

/** Keys the editor binds (EditorShortcuts) and gestures it handles in its views. */
export const EDITOR_HELP: ShortcutHelp[] = [
  { keys: ['Mod+F'], label: 'Find in file', section: 'Search' },
  { keys: ['Enter', 'Shift+Enter'], label: 'Next / previous match', section: 'Search' },
  { keys: ['Double click'], label: 'Highlight all occurrences', section: 'Search' },
  { keys: ['F12', 'Mod+Click'], label: 'Go to definition', section: 'Navigation' },
  { keys: ['Shift+F12'], label: 'Find all references', section: 'Navigation' },
  { keys: ['Shift+F1'], label: 'Show symbol documentation', section: 'Navigation' },
  { keys: ['Alt+Shift+H'], label: 'Call trail (callers / callees)', section: 'Navigation' },
  { keys: ['Alt+Left', 'Alt+Right'], label: 'Navigate back / forward', section: 'Navigation' },
  {
    keys: ['Mod+Home|Mod+Up', 'Mod+End|Mod+Down'],
    label: 'Top / bottom of file',
    section: 'Navigation',
  },
  { keys: ['Home|Mod+Left', 'End|Mod+Right'], label: 'Start / end of line', section: 'Navigation' },
  { keys: ['Left', 'Right'], label: 'Move caret along the line', section: 'Navigation' },
  { keys: ['Mod+E'], label: 'Toggle edit mode', section: 'Editing' },
  { keys: ['Mod+S'], label: 'Save file (in edit mode)', section: 'Editing' },
  { keys: ['Alt+Z'], label: 'Toggle word wrap', section: 'Editing' },
  { keys: ['Mod+A'], label: 'Select whole file', section: 'Selection' },
  { keys: ['Mod+C'], label: 'Copy selection (source / formatted text)', section: 'Selection' },
  { keys: ['Alt+C', 'Alt+A'], label: 'Copy selection ref / with context', section: 'Selection' },
  { keys: ['Alt+U'], label: 'Find usages of selection', section: 'Selection' },
  { keys: ['Alt+E'], label: 'Edit selection inline', section: 'Selection' },
  { keys: ['Alt+T'], label: 'Start a thread on the selection', section: 'Selection' },
  { keys: ['Alt+X'], label: 'Explain the selection', section: 'Selection' },
  {
    keys: ['Alt+R'],
    label: 'Review comment on the selection (pull requests)',
    section: 'Selection',
  },
  { keys: ['Alt+S', 'Alt+M'], label: 'Copy selection source / raw Markdown', section: 'Selection' },
  { keys: ['Right click'], label: 'Selection actions at the pointer', section: 'Selection' },
  { keys: ['Alt+W'], label: 'Close tab', section: 'Tabs' },
  { keys: ['Alt+Shift+T'], label: 'Reopen closed tab', section: 'Tabs' },
  { keys: ['Ctrl+Tab', 'Ctrl+Shift+Tab'], label: 'Next / previous tab', section: 'Tabs' },
  { keys: ['Alt+1…9'], label: 'Select tab', section: 'Tabs' },
];

export const PALETTE_HELP: ShortcutHelp[] = [
  { keys: ['Mod+P'], label: 'Go to file', section: 'General' },
  { keys: ['Mod+Shift+P'], label: 'Command palette', section: 'General' },
];

export const REVIEW_HELP: ShortcutHelp[] = [
  { keys: ['Mod+Shift+V'], label: 'Toggle the review overview', section: 'Diff and preview' },
];

export const AGENT_HELP: ShortcutHelp[] = [
  { keys: ['Mod+Shift+Enter'], label: 'Apply all queued inline edits', section: 'Editing' },
];
