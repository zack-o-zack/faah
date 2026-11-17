export const themeModes = [
  { id: '', name: 'System', icon: 'icon-[ph--monitor]' },
  { id: 'light', name: 'Light', icon: 'icon-[ph--sun]' },
  { id: 'dark', name: 'Dark', icon: 'icon-[ph--moon]' },
] as const;

export function themeMode(value: string): (typeof themeModes)[number] {
  return themeModes.find((mode) => mode.id === value) ?? themeModes[0];
}

export function nextThemeMode(value: string): (typeof themeModes)[number]['id'] {
  switch (themeMode(value).id) {
    case '':
      return 'light';
    case 'light':
      return 'dark';
    case 'dark':
      return '';
  }
}

export function themeToggleLabel(value: string): string {
  return `Theme: ${themeMode(value).name}. Switch to ${themeMode(nextThemeMode(value)).name}`;
}
