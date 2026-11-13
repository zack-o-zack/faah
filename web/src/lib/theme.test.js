import { expect, test } from 'vitest';
import { render } from '@solidjs/testing-library';
import { DEFAULT_THEME, chooseThemePreference } from './theme-preference.js';
import { createThemeStore } from './theme.js';

test('prefers saved theme over fallback default setting', () => {
  expect(chooseThemePreference('nord', DEFAULT_THEME)).toBe('nord');
});

test('prefers explicit non-default server setting over stored theme', () => {
  expect(chooseThemePreference('nord', 'dracula')).toBe('dracula');
});

test('falls back to default when nothing else is set', () => {
  expect(chooseThemePreference(null, null)).toBe(DEFAULT_THEME);
});

test('ignores removed faah theme preferences while preserving other choices', () => {
  expect(chooseThemePreference('faah', 'faah')).toBe(DEFAULT_THEME);
  expect(chooseThemePreference('faah', DEFAULT_THEME)).toBe(DEFAULT_THEME);
  expect(chooseThemePreference('nord', 'faah')).toBe('nord');
  expect(chooseThemePreference('faah', 'dracula')).toBe('dracula');
});

test('applying themes updates the dark class, including boot and repeated applications', () => {
  const style = document.createElement('style');
  style.textContent =
    ':root[data-theme="catppuccin-mocha"] { color-scheme: dark; } :root[data-theme="light"] { color-scheme: light; }';
  document.head.append(style);
  let store;
  const view = render(() => {
    store = createThemeStore();
    return null;
  });
  const dark = () => document.documentElement.classList.contains('dark');
  expect(dark()).toBe(true);
  store.setTheme('light', false);
  expect(dark()).toBe(false);
  store.setTheme('catppuccin-mocha', false);
  expect(dark()).toBe(true);
  expect(store.setTheme('missing', false)).toBe(false);
  view.unmount();
  style.remove();
});
