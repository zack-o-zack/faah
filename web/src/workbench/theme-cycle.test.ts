import { expect, test } from 'vitest';
import { nextThemeMode, themeMode, themeModes, themeToggleLabel } from './theme-cycle.ts';

test('theme modes cycle System, Light, Dark and wrap', () => {
  expect(themeModes.map((mode) => mode.name)).toEqual(['System', 'Light', 'Dark']);
  expect(themeModes.map((mode) => mode.id)).toEqual(['', 'light', 'dark']);
  expect(nextThemeMode('')).toBe('light');
  expect(nextThemeMode('light')).toBe('dark');
  expect(nextThemeMode('dark')).toBe('');
});

test('an unknown preference reads as System', () => {
  expect(themeMode('custom').name).toBe('System');
  expect(themeMode('custom').icon).toBe('icon-[ph--monitor]');
  expect(nextThemeMode('custom')).toBe('light');
});

test('labels name the current mode and the next one', () => {
  expect(themeToggleLabel('')).toBe('Theme: System. Switch to Light');
  expect(themeToggleLabel('light')).toBe('Theme: Light. Switch to Dark');
  expect(themeToggleLabel('dark')).toBe('Theme: Dark. Switch to System');
  expect(themeToggleLabel('custom')).toBe('Theme: System. Switch to Light');
});
