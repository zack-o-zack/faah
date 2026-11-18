/** Configured wins over saved. Unknown IDs follow the OS without aliases. */
export function chooseThemePreference(
  savedTheme: string | null | undefined,
  configuredTheme: string | null | undefined,
  systemDark: boolean,
  available: readonly string[] = ['light', 'dark'],
): string {
  const id = configuredTheme || savedTheme;
  if (id && available.includes(id)) return id;
  return systemDark ? 'dark' : 'light';
}

/**
 * The code theme the active app scheme asks for. One choice per scheme, so
 * switching Light/Dark swaps the code theme with it. Empty keeps the app
 * theme's own code colours; an unknown or missing choice falls back to empty.
 */
export function chooseCodeTheme(
  scheme: string | undefined,
  lightTheme: string | null | undefined,
  darkTheme: string | null | undefined,
  available: readonly string[],
): string {
  const id = scheme === 'dark' ? darkTheme : lightTheme;
  return id && available.includes(id) ? id : '';
}
