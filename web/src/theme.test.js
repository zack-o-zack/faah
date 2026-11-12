import { test } from 'vitest';
import assert from 'node:assert/strict';

import { DEFAULT_THEME, chooseThemePreference } from './lib/theme-preference.js';

test('prefers saved theme over fallback default setting', () => {
  assert.equal(chooseThemePreference('nord', DEFAULT_THEME), 'nord');
});

test('prefers explicit non-default server setting over stored theme', () => {
  assert.equal(chooseThemePreference('nord', 'dracula'), 'dracula');
});

test('falls back to default when nothing else is set', () => {
  assert.equal(chooseThemePreference(null, null), DEFAULT_THEME);
});

test('ignores removed faah theme preferences while preserving other choices', () => {
  assert.equal(chooseThemePreference('faah', 'faah'), DEFAULT_THEME);
  assert.equal(chooseThemePreference('faah', DEFAULT_THEME), DEFAULT_THEME);
  assert.equal(chooseThemePreference('nord', 'faah'), 'nord');
  assert.equal(chooseThemePreference('faah', 'dracula'), 'dracula');
});


import { createRoot } from 'solid-js';
import { render } from '@solidjs/testing-library';
import { createThemeStore } from './lib/theme.js';
test('applying themes updates the dark class, including boot and repeated applications', () => {
  const style = document.createElement('style');
  style.textContent = ':root[data-theme="catppuccin-mocha"] { color-scheme: dark; } :root[data-theme="light"] { color-scheme: light; }';
  document.head.append(style);
  let store;
  const view = render(() => { store = createThemeStore(); return null; });
  assert.ok(document.documentElement.classList.contains('dark'));
  store.setTheme('light', false); assert.ok(!document.documentElement.classList.contains('dark'));
  store.setTheme('catppuccin-mocha', false); assert.ok(document.documentElement.classList.contains('dark'));
  assert.equal(store.setTheme('missing', false), false);
  view.unmount(); style.remove();
});
