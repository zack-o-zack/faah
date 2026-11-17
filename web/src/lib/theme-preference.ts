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
