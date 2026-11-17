import { afterEach, expect, test, vi } from 'vitest';
import { render } from '@solidjs/testing-library';
import { readFileSync } from 'node:fs';
import { chooseThemePreference } from './theme-preference.ts';
import { createThemeStore, listThemes } from './theme.ts';
import { required } from './test-values.ts';

function styles(): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = ['light', 'dark']
    .map((id) => readFileSync('web/themes/' + id + '.css', 'utf8'))
    .join('\n');
  document.head.append(style);
  return style;
}
afterEach(() => {
  localStorage.removeItem('faah.theme');
  delete document.documentElement.dataset.themePreference;
});
test.each([false, true])('empty preferences follow the OS (dark=%s)', (dark) => {
  expect(chooseThemePreference(null, null, dark)).toBe(dark ? 'dark' : 'light');
});
test('existing saved IDs win, configured beats saved, and removed IDs follow the OS', () => {
  expect(chooseThemePreference('dark', '', false)).toBe('dark');
  expect(chooseThemePreference('dark', 'light', true)).toBe('light');
  expect(chooseThemePreference('removed-theme', null, true)).toBe('dark');
  expect(chooseThemePreference('dark', 'missing-theme', false)).toBe('light');
  expect(chooseThemePreference('custom', '', false, ['light', 'dark', 'custom'])).toBe('custom');
});
test('discovers both fibo themes and retains metadata through user overrides', () => {
  const style = styles();
  style.textContent +=
    ':root[data-theme="dark"] { --spiral: rgb(238, 238, 238); } [data-theme="custom"] { --theme-name: "Custom"; color-scheme: dark; }';
  expect(listThemes()).toEqual([
    { id: 'custom', name: 'Custom', scheme: 'dark' },
    { id: 'dark', name: 'Dark', scheme: 'dark' },
    { id: 'light', name: 'Light', scheme: 'light' },
  ]);
  style.remove();
});
test('updates the dark class, previews without saving and rejects unknown IDs', () => {
  const style = styles();
  let store: ReturnType<typeof createThemeStore> | undefined;
  const view = render(() => {
    store = createThemeStore();
    return null;
  });
  expect(document.documentElement.dataset.theme).toBe('light');
  required(store).setTheme('dark', false);
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  required(store).setTheme('light', false);
  expect(document.documentElement.classList.contains('dark')).toBe(false);
  expect(required(store).setTheme('missing-theme', false)).toBe(false);
  expect(localStorage.getItem('faah.theme')).toBeNull();
  view.unmount();
  style.remove();
});
test('system preference changes are live and remove their listener at disposal', () => {
  const style = styles();
  const events = new EventTarget();
  const remove = vi.fn(events.removeEventListener.bind(events));
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches: false,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: remove,
    dispatchEvent: events.dispatchEvent.bind(events),
  });
  const view = render(() => {
    createThemeStore();
    return null;
  });
  events.dispatchEvent(Object.assign(new Event('change'), { matches: true }));
  expect(document.documentElement.dataset.theme).toBe('dark');
  events.dispatchEvent(Object.assign(new Event('change'), { matches: false }));
  expect(document.documentElement.dataset.theme).toBe('light');
  view.unmount();
  expect(remove).toHaveBeenCalled();
  style.remove();
});

test('a launcher pick replaces its initial configured preference, including System', () => {
  const style = styles();
  document.documentElement.dataset.themePreference = 'dark';
  localStorage.setItem('faah.theme', 'light');
  const save = vi.fn();
  let store: ReturnType<typeof createThemeStore> | undefined;
  const view = render(() => {
    store = createThemeStore({ save });
    return null;
  });
  expect(required(store).current()).toBe('dark');
  required(store).setTheme('light');
  expect(required(store).current()).toBe('light');
  expect(save).toHaveBeenLastCalledWith('light');
  required(store).setTheme('');
  expect(required(store).preference()).toBe('');
  expect(save).toHaveBeenLastCalledWith('');
  required(store).setTheme('dark', false);
  required(store).setTheme('', false);
  expect(required(store).current()).toBe('light');
  view.unmount();
  style.remove();
});
