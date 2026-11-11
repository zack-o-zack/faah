import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_THEME, chooseThemePreference } from './theme-preference.js';

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

test('applying themes updates the dark class, including boot and repeated applications', async () => {
  const previousDocument = globalThis.document;
  const previousStorage = globalThis.localStorage;
  const classes = new Set();
  globalThis.document = {
    querySelector: () => null,
    documentElement: { dataset: {}, classList: { toggle(name, on) { on ? classes.add(name) : classes.delete(name); } } },
    styleSheets: [{ cssRules: ['catppuccin-mocha', 'light'].map(id => ({
      selectorText: `:root[data-theme="${id}"]`,
      style: { getPropertyValue: name => name === 'color-scheme' ? (id === 'light' ? 'light' : 'dark') : id },
    })) }],
  };
  globalThis.localStorage = { getItem: () => null };
  try {
    const { initTheme, setTheme } = await import('./theme.js');
    initTheme();
    assert.ok(classes.has('dark'));
    setTheme('light', false);
    assert.ok(!classes.has('dark'));
    setTheme('catppuccin-mocha', false);
    assert.ok(classes.has('dark'));
    classes.clear();
    setTheme('catppuccin-mocha', false);
    assert.ok(classes.has('dark'));
    assert.equal(setTheme('missing', false), false);
  } finally {
    globalThis.document = previousDocument;
    globalThis.localStorage = previousStorage;
  }
});
