import { createRoot } from 'solid-js';
import { expect, test } from 'vitest';
import { CHORD_WINDOW, chordStep, createShortcutRegistry } from './registry.ts';

test('the help lists what is described, by section, until its owner releases it', () => {
  createRoot((dispose) => {
    const registry = createShortcutRegistry();
    const release = registry.describe([
      { keys: ['Alt+W'], label: 'Close tab', section: 'Tabs' },
      { keys: ['Mod+,'], label: 'Open settings', section: 'General' },
    ]);
    registry.describe([{ keys: ['?'], label: 'Keyboard shortcuts', section: 'General' }]);
    expect(registry.groups().map((group) => [group.section, group.entries.length])).toEqual([
      ['General', 2],
      ['Tabs', 1],
    ]);
    release();
    expect(registry.groups().map((group) => group.section)).toEqual(['General']);
    registry.actions.showHelp();
    expect(registry.helpOpen()).toBe(true);
    dispose();
  });
});

test('bracket chords step hunks and files within the window', () => {
  expect(chordStep({ prefix: ']', at: 0 }, 'c', 100)).toEqual({ target: 'hunk', direction: 1 });
  expect(chordStep({ prefix: '[', at: 0 }, 'f', 100)).toEqual({ target: 'file', direction: -1 });
  expect(chordStep({ prefix: '[', at: 0 }, 'c', CHORD_WINDOW)).toBe(null);
  expect(chordStep({ prefix: '[', at: 0 }, 'x', 10)).toBe(null);
  expect(chordStep(null, 'c', 10)).toBe(null);
});
