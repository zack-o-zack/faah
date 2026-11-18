import { test, expect } from 'vitest';
import {
  detectMac,
  keyChord,
  keyChordLabel,
  keyLabel,
  keyCaps,
  withKeys,
  matchesShortcut,
} from './keyboard.ts';
test('formats platform-specific shortcuts without DOM', () => {
  expect(detectMac('iPad')).toBe(true);
  expect(keyLabel('Mod+Shift+F', true)).toBe('⌘⇧F');
  expect(keyLabel('Mod+Click', true)).toBe('⌘ Click');
  expect(keyLabel('Mod+P', false)).toBe('Ctrl+P');
  expect(keyLabel('Ctrl+A|', true)).toBe('');
  expect(keyCaps('Mod+P', true)).toEqual(['⌘', 'P']);
  expect(keyCaps('Mod+Shift+F', true)).toEqual(['⌘', '⇧', 'F']);
  expect(keyCaps('Mod+Shift+F', false)).toEqual(['Ctrl', 'Shift', 'F']);
  expect(keyCaps('Mod+Enter', true)).toEqual(['⌘', '↩']);
  expect(withKeys('Search ({Mod+Shift+F})', true)).toBe('Search (⌘⇧F)');
  expect(withKeys('Open ({Mod+P})', false)).toBe('Open (Ctrl+P)');
});
test('chords become one cap and keep a readable name', () => {
  expect(keyChord('Mod+Shift+P', true)).toBe('⌘⇧P');
  expect(keyChord('Ctrl+D', true)).toBe('⌃D');
  expect(keyChord('Mod+D', false)).toBe('Ctrl+D');
  expect(keyChord('gg', true)).toBe('gg');
  expect(keyChord('[N]gt', true)).toBe('[N]gt');
  expect(keyChord('Mod+Click', true)).toBe('⌘Click');
  expect(keyChordLabel('Mod+Shift+P', true)).toBe('Command Shift P');
  expect(keyChordLabel('Alt+Left', true)).toBe('Option Left');
  expect(keyChordLabel('Mod+D', false)).toBe('Ctrl D');
});
test('matches exact modifiers', () => {
  const event = { key: 'p', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false };
  expect(matchesShortcut(event, 'Mod+P', false)).toBe(true);
  expect(matchesShortcut({ ...event, shiftKey: true }, 'Mod+P', false)).toBe(false);
});

test('hidden-folder shortcut accepts the shifted period key', () => {
  expect(
    matchesShortcut(
      { key: '>', code: 'Period', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false },
      'Mod+Shift+.',
      false,
    ),
  ).toBe(true);
});

test('navigation aliases match browser Arrow key names', () => {
  const event = { key: 'ArrowLeft', altKey: true, metaKey: false, ctrlKey: false, shiftKey: false };
  expect(matchesShortcut(event, 'Alt+Left', false)).toBe(true);
});
