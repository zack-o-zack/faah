import { createEffect, createSignal, onCleanup } from 'solid-js';
import { apiPostJson } from './api.js';
import { DEFAULT_THEME, chooseThemePreference } from './theme-preference.js';
export { DEFAULT_THEME, chooseThemePreference };
const KEY = 'faah.theme';
// Discover themes from CSS so adding one needs no JavaScript change.
const THEME_SELECTOR = /^(?::root|html)?\[data-theme=["']?([\w-]+)["']?\]$/;

function getStoredTheme() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

function listThemes() {
  const found = new Map();
  const walk = rules => {
    for (const r of rules) {
      if (r.styleSheet) { try { walk(r.styleSheet.cssRules); } catch {} continue; } // @import
      if (!r.selectorText) { if (r.cssRules) walk(r.cssRules); continue; }       // @media, @layer
      for (const part of r.selectorText.split(',')) {
        const m = part.trim().match(THEME_SELECTOR);
        if (!m) continue;
        const t = found.get(m[1]) || { id: m[1], name: m[1], scheme: '' };
        const name = r.style.getPropertyValue('--theme-name').trim().replace(/^["']|["']$/g, '');
        const scheme = r.style.getPropertyValue('color-scheme').trim();
        if (name) t.name = name;
        if (scheme) t.scheme = scheme;
        found.set(m[1], t);
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try { walk(sheet.cssRules); } catch {} // cross-origin sheets (web fonts) are unreadable
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export { listThemes, getStoredTheme };
export function createThemeStore() {
  const [preference, setPreference] = createSignal(chooseThemePreference(getStoredTheme(), document.documentElement.dataset.theme));
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const [dark, setDark] = createSignal(media.matches);
  const changed = event => setDark(event.matches);
  media.addEventListener('change', changed);
  onCleanup(() => media.removeEventListener('change', changed));
  function resolve(id) {
    const all = listThemes();
    if (id === 'system') id = dark() ? 'dark' : 'light';
    return all.find(t => t.id === id) || all.find(t => t.scheme === id) || all.find(t => t.id === DEFAULT_THEME);
  }
  const current = () => resolve(preference())?.id || preference();
  createEffect(() => {
    const theme = resolve(preference());
    if (!theme) return;
    document.documentElement.dataset.theme = theme.id;
    document.documentElement.classList.toggle('dark', theme.scheme === 'dark');
  });
  return { preference, current, themes: listThemes, setTheme(id, persist = true) {
    if (!['system', 'light', 'dark'].includes(id) && !listThemes().some(t => t.id === id)) return false;
    setPreference(id);
    if (persist) {
      try { localStorage.setItem(KEY, id); } catch {}
      void apiPostJson('api/settings', { 'workbench.colorTheme': id }).catch(() => {});
    }
    return true;
  } };
}
