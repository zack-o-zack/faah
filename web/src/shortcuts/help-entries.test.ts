import { expect, test } from 'vitest';
import { VIM_SHORTCUT_SECTIONS } from '../editor/vim-help.ts';
import { STANDARD_SHEET_SECTIONS } from './help-entries.ts';

const standardRows = STANDARD_SHEET_SECTIONS.flatMap((section) => section.items);
const vimRows = VIM_SHORTCUT_SECTIONS.flatMap((section) => section.items);
const labels = (rows: [string[], string][]): string[] => rows.map(([, label]) => label);

test('the Standard sheet keeps every entry in its named sections', () => {
  expect(STANDARD_SHEET_SECTIONS.map((section) => section.title)).toEqual([
    'General',
    'Editor',
    'Code',
    'Diff',
    'Tabs and panels',
    'Selection',
  ]);
  expect(standardRows).toHaveLength(41);
  for (const section of STANDARD_SHEET_SECTIONS) expect(section.items.length).toBeGreaterThan(0);
  for (const [, label] of standardRows) expect(label).not.toBe('');
});

test('the Standard sheet keeps the old rows', () => {
  expect(labels(standardRows)).toEqual(
    expect.arrayContaining([
      'Open settings',
      'Go to file',
      'Toggle edit mode',
      'Go to definition',
      'Toggle diff view (git)',
      'Close tab',
      'Select whole file',
      'Explain the selection',
      'Dismiss',
    ]),
  );
  expect(standardRows).toContainEqual([['Mod+,'], 'Open settings']);
  expect(standardRows).toContainEqual([['[c', ']c'], 'Previous / next diff hunk']);
  expect(standardRows).toContainEqual([['Alt+C', 'Alt+A'], 'Copy selection ref / with context']);
  expect(standardRows).toContainEqual([
    ['Mod+Home|Mod+Up', 'Mod+End|Mod+Down'],
    'Top / bottom of file',
  ]);
});

test('the Vim sheet keeps every item in its named sections', () => {
  expect(VIM_SHORTCUT_SECTIONS.map((section) => section.title)).toEqual([
    'Modes & Motions',
    'Code Intelligence & LSP',
    'Search & Occurrences',
    'Visual Mode & AI Agent Actions',
    'Tabs & Commands',
  ]);
  expect(vimRows).toHaveLength(28);
  for (const section of VIM_SHORTCUT_SECTIONS) expect(section.items.length).toBeGreaterThan(0);
  expect(vimRows).toContainEqual([['gg', 'G'], 'First line / last line (or [count]gg / [count]G)']);
  expect(vimRows).toContainEqual([['Ctrl+D', 'Ctrl+U'], 'Scroll half-page down / up']);
  expect(vimRows).toContainEqual([['[N]gt'], 'Switch to tab N']);
  expect(vimRows).toContainEqual([['u'], 'Find usages of selected symbol']);
});
