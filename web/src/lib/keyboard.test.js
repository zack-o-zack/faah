import { test, expect } from 'vitest';
import { detectMac, keyLabel, keyCaps, withKeys, matchesShortcut } from './keyboard.js';
test('formats platform-specific shortcuts without DOM', () => {
  expect(detectMac('iPad')).toBe(true);
  expect(keyLabel('Mod+Shift+F', true)).toBe('⌘⇧F');
  expect(keyLabel('Mod+Click', true)).toBe('⌘ Click');
  expect(keyLabel('Mod+P', false)).toBe('Ctrl+P');
  expect(keyLabel('Ctrl+A|', true)).toBe('');
  expect(keyCaps('Mod+P', true)).toEqual(['⌘', 'P']);
  expect(withKeys('Open ({Mod+P})', false)).toBe('Open (Ctrl+P)');
});
test('matches exact modifiers', () => {
  const event = { key: 'p', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false };
  expect(matchesShortcut(event, 'Mod+P', false)).toBe(true);
  expect(matchesShortcut({ ...event, shiftKey: true }, 'Mod+P', false)).toBe(false);
});

test('hidden-folder shortcut accepts the shifted period key', () => {
  expect(matchesShortcut({ key: '>', code: 'Period', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }, 'Mod+Shift+.', false)).toBe(true);
});
