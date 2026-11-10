export const DEFAULT_THEME = 'catppuccin-mocha';

export function chooseThemePreference(savedTheme, configuredTheme, fallbackTheme = DEFAULT_THEME) {
  // Existing profiles may still refer to the removed built-in theme.
  if (savedTheme === 'faah') savedTheme = null;
  if (configuredTheme === 'faah') configuredTheme = null;
  const explicit = configuredTheme && configuredTheme !== fallbackTheme ? configuredTheme : null;
  const saved = savedTheme && savedTheme !== fallbackTheme ? savedTheme : null;
  if (explicit) return explicit;
  if (saved) return saved;
  return fallbackTheme;
}
