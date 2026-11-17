import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, test, vi } from 'vitest';
import { SettingsProvider } from './context.ts';
import { createSettingsStore } from './store.ts';
import { SettingControl } from './SettingControl.tsx';
import type { SettingItem } from './logic.ts';

vi.mock('../lib/toast.tsx', () => ({ toast: vi.fn() }));
const item: SettingItem = {
  key: 'workbench.colorTheme',
  title: 'Color Theme',
  description: '',
  category: 'Workbench',
  type: 'select',
  default: '',
  options: ['', 'light', 'dark'],
  secret: false,
};
const styles: HTMLStyleElement[] = [];
afterEach(() => styles.splice(0).forEach((style) => style.remove()));
async function mount(custom = false) {
  const style = document.createElement('style');
  style.textContent =
    ':root[data-theme="light"] { --theme-name: "Light"; } :root[data-theme="dark"] { --theme-name: "Dark"; }' +
    (custom ? ':root[data-theme="custom"] { --theme-name: "My theme"; }' : '');
  document.head.append(style);
  styles.push(style);
  const post = vi.fn(async (_path: string, body: unknown) => ({ settings: body, raw: '{}' }));
  render(() => {
    const settings = createSettingsStore({
      request: async () => ({ settings: { [item.key]: '' }, schema: [item] }),
      post,
    });
    void settings.actions.loadSettings();
    return (
      <SettingsProvider value={settings}>
        <SettingControl item={item} control={{ kind: 'select', options: [] }} invalid={false} />
      </SettingsProvider>
    );
  });
  await waitFor(() =>
    expect(screen.getByRole('radio', { name: 'System' }).getAttribute('aria-checked')).toBe('true'),
  );
  return post;
}

test('built-ins use only the switcher and save their preference', async () => {
  const post = await mount();
  expect(screen.queryByRole('combobox')).toBeNull();
  fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
  await waitFor(() =>
    expect(post).toHaveBeenLastCalledWith(
      'api/settings',
      { [item.key]: 'dark' },
      expect.anything(),
    ),
  );
});

test('only extra themes appear in the user select and clear segment selection', async () => {
  const post = await mount(true);
  const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'User theme' });
  expect(
    Array.from(select.options)
      .filter((option) => !option.disabled)
      .map((option) => option.value),
  ).toEqual(['custom']);
  fireEvent.change(select, { target: { value: 'custom' } });
  await waitFor(() =>
    expect(post).toHaveBeenLastCalledWith(
      'api/settings',
      { [item.key]: 'custom' },
      expect.anything(),
    ),
  );
  expect(
    screen.getAllByRole('radio').every((radio) => radio.getAttribute('aria-checked') === 'false'),
  ).toBe(true);
  fireEvent.click(screen.getByRole('radio', { name: 'System' }));
  await waitFor(() =>
    expect(post).toHaveBeenLastCalledWith('api/settings', { [item.key]: '' }, expect.anything()),
  );
  expect(select.value).toBe('');
});
