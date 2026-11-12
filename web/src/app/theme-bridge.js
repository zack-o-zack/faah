// Removed when the last legacy module is migrated.
import { createEffect, on } from 'solid-js';
import { listThemes, getStoredTheme, DEFAULT_THEME, chooseThemePreference } from '../lib/theme.js';
import { toast } from '../lib/toast.jsx';
export { listThemes, getStoredTheme, DEFAULT_THEME, chooseThemePreference };
let store;
export function attachLegacyTheme(value) {
  store = value;
}
export const currentTheme = () => store.current();
export const setTheme = (id, persist) => store.setTheme(id, persist);
export function cycleTheme() {
  const all = listThemes();
  const next = all[(all.findIndex((t) => t.id === currentTheme()) + 1) % all.length];
  if (next) {
    setTheme(next.id);
    toast('Theme', next.name);
  }
}
export function onThemeChanged(fn) {
  createEffect(on(store.current, fn, { defer: true }));
}
