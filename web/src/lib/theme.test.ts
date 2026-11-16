import { afterEach, expect, test, vi } from 'vitest';
import { render } from '@solidjs/testing-library';
import { readFileSync } from 'node:fs';
import { chooseThemePreference } from './theme-preference.ts';
import { createThemeStore, listThemes } from './theme.ts';
import { required } from './test-values.ts';

function styles(): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = ['fibo-light', 'fibo-dark']
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
  expect(chooseThemePreference(null, null, dark)).toBe(dark ? 'fibo-dark' : 'fibo-light');
});
test('existing saved IDs win, configured beats saved, and removed IDs follow the OS', () => {
  expect(chooseThemePreference('fibo-dark', '', false)).toBe('fibo-dark');
  expect(chooseThemePreference('fibo-dark', 'fibo-light', true)).toBe('fibo-light');
  expect(chooseThemePreference('removed-theme', null, true)).toBe('fibo-dark');
  expect(chooseThemePreference('fibo-dark', 'missing-theme', false)).toBe('fibo-light');
  expect(chooseThemePreference('custom', '', false, ['fibo-light', 'fibo-dark', 'custom'])).toBe(
    'custom',
  );
});
test('discovers both fibo themes and retains metadata through user overrides', () => {
  const style = styles();
  style.textContent +=
    ':root[data-theme="fibo-dark"] { --spiral: #eeeeee; } [data-theme="custom"] { --theme-name: "Custom"; color-scheme: dark; }';
  expect(listThemes()).toEqual([
    { id: 'custom', name: 'Custom', scheme: 'dark' },
    { id: 'fibo-dark', name: 'fibo dark', scheme: 'dark' },
    { id: 'fibo-light', name: 'fibo light', scheme: 'light' },
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
  expect(document.documentElement.dataset.theme).toBe('fibo-light');
  required(store).setTheme('fibo-dark', false);
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  required(store).setTheme('fibo-light', false);
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
  expect(document.documentElement.dataset.theme).toBe('fibo-dark');
  events.dispatchEvent(Object.assign(new Event('change'), { matches: false }));
  expect(document.documentElement.dataset.theme).toBe('fibo-light');
  view.unmount();
  expect(remove).toHaveBeenCalled();
  style.remove();
});

test('a launcher pick replaces its initial configured preference, including System', () => {
  const style = styles();
  document.documentElement.dataset.themePreference = 'fibo-dark';
  localStorage.setItem('faah.theme', 'fibo-light');
  const save = vi.fn();
  let store: ReturnType<typeof createThemeStore> | undefined;
  const view = render(() => {
    store = createThemeStore({ save });
    return null;
  });
  expect(required(store).current()).toBe('fibo-dark');
  required(store).setTheme('fibo-light');
  expect(required(store).current()).toBe('fibo-light');
  expect(save).toHaveBeenLastCalledWith('fibo-light');
  required(store).setTheme('');
  expect(required(store).preference()).toBe('');
  expect(save).toHaveBeenLastCalledWith('');
  required(store).setTheme('fibo-dark', false);
  required(store).setTheme('', false);
  expect(required(store).current()).toBe('fibo-light');
  view.unmount();
  style.remove();
});
