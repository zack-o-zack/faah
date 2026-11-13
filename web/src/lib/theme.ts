export interface Theme {
  id: string;
  name: string;
  scheme: string;
}
export interface ThemeOptions {
  configured?: () => string | undefined;
  save?: (id: string) => void;
}
export interface ThemeStore {
  preference: () => string;
  current: () => string;
  themes: () => Theme[];
  setTheme: (id: string, persist?: boolean) => boolean;
}
function isImport(rule: CSSRule): rule is CSSImportRule {
  return 'styleSheet' in rule;
}
function isGroup(rule: CSSRule): rule is CSSGroupingRule {
  return 'cssRules' in rule;
}
import { createEffect, createSignal, onCleanup } from 'solid-js';
import { apiPostJson } from './api.ts';
import { DEFAULT_THEME, chooseThemePreference } from './theme-preference.ts';
export { DEFAULT_THEME, chooseThemePreference };
const KEY = 'faah.theme';
// Discover themes from CSS so adding one needs no JavaScript change.
const THEME_SELECTOR = /^(?::root|html)?\[data-theme=["']?([\w-]+)["']?\]$/;

function getStoredTheme(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function listThemes(): Theme[] {
  const found = new Map<string, Theme>();
  const walk = (rules: CSSRuleList): void => {
    for (const r of rules) {
      if (isImport(r) && r.styleSheet) {
        try {
          walk(r.styleSheet.cssRules);
        } catch {
          // Imported cross-origin stylesheets are unreadable.
        }
        continue;
      } // @import
      if (!(r instanceof CSSStyleRule)) {
        if (isGroup(r)) walk(r.cssRules);
        continue;
      } // @media, @layer
      for (const part of r.selectorText.split(',')) {
        const m = part.trim().match(THEME_SELECTOR);
        if (!m?.[1]) continue;
        const t = found.get(m[1]) || { id: m[1], name: m[1], scheme: '' };
        const name = r.style
          .getPropertyValue('--theme-name')
          .trim()
          .replace(/^["']|["']$/g, '');
        const scheme = r.style.getPropertyValue('color-scheme').trim();
        if (name) t.name = name;
        if (scheme) t.scheme = scheme;
        found.set(m[1], t);
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules);
    } catch {
      // Cross-origin sheets (web fonts) are unreadable.
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export { listThemes, getStoredTheme };
/**
 * The theme follows the configured setting (options.configured) unless this browser picked
 * another; a preview (setTheme with persist false) shows over both until it is cleared.
 * options.save persists a pick as the setting; without it the pick goes to /api/settings.
 */
export function createThemeStore(options: ThemeOptions = {}): ThemeStore {
  const [stored, setStored] = createSignal(getStoredTheme());
  const initial = document.documentElement.dataset.theme;
  const [preview, setPreview] = createSignal<string | null>(null);
  const chosen = () =>
    chooseThemePreference(stored(), options.configured ? options.configured() : initial);
  const preference = () => preview() ?? chosen();
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const [dark, setDark] = createSignal(media.matches);
  const changed = (event: MediaQueryListEvent) => setDark(event.matches);
  media.addEventListener('change', changed);
  onCleanup(() => media.removeEventListener('change', changed));
  function resolve(id: string): Theme | undefined {
    const all = listThemes();
    if (id === 'system') id = dark() ? 'dark' : 'light';
    return (
      all.find((t) => t.id === id) ||
      all.find((t) => t.scheme === id) ||
      all.find((t) => t.id === DEFAULT_THEME)
    );
  }
  const current = () => resolve(preference())?.id || preference();
  createEffect(() => {
    const theme = resolve(preference());
    if (!theme) return;
    document.documentElement.dataset.theme = theme.id;
    document.documentElement.classList.toggle('dark', theme.scheme === 'dark');
  });
  return {
    preference,
    current,
    themes: listThemes,
    setTheme(id: string, persist = true) {
      if (!['system', 'light', 'dark'].includes(id) && !listThemes().some((t) => t.id === id))
        return false;
      if (!persist) {
        setPreview(id === chosen() ? null : id);
        return true;
      }
      setPreview(null);
      setStored(id);
      try {
        localStorage.setItem(KEY, id);
      } catch {
        // Storage can be unavailable in restricted browser profiles.
      }
      if (options.save) options.save(id);
      else void apiPostJson('api/settings', { 'workbench.colorTheme': id }).catch(() => {});
      return true;
    },
  };
}
