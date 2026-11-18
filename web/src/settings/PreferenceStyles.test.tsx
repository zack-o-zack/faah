import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, test, vi } from 'vitest';
import { SettingsProvider } from './context.ts';
import { createSettingsStore } from './store.ts';
import { PreferenceStyles } from './PreferenceStyles.tsx';
import { SettingControl } from './SettingControl.tsx';
import { settingControl, type SettingItem } from './logic.ts';

vi.mock('../lib/toast.tsx', () => ({ toast: vi.fn() }));
afterEach(() => document.documentElement.removeAttribute('data-transparency'));

test('the Transparency segments save and update the root live', async () => {
  const item: SettingItem = {
    key: 'workbench.transparency',
    title: 'Transparency',
    description: '',
    category: 'Workbench',
    type: 'select',
    default: 'subtle',
    options: ['off', 'subtle', 'strong'],
    secret: false,
  };
  const post = vi.fn(async (_path: string, body: unknown) => ({ settings: body, raw: '{}' }));
  render(() => {
    const settings = createSettingsStore({
      request: async () => ({ settings: { [item.key]: 'strong' }, schema: [item] }),
      post,
    });
    void settings.actions.loadSettings();
    return (
      <SettingsProvider value={settings}>
        <PreferenceStyles />
        <SettingControl item={item} control={settingControl(item)} invalid={false} />
      </SettingsProvider>
    );
  });
  await waitFor(() => expect(document.documentElement.dataset.transparency).toBe('strong'));
  expect(screen.getByRole('group', { name: 'Transparency' })).toBeTruthy();
  for (const level of ['off', 'subtle', 'strong']) {
    fireEvent.click(screen.getByRole('button', { name: level }));
    await waitFor(() => expect(document.documentElement.dataset.transparency).toBe(level));
    expect(post).toHaveBeenLastCalledWith('api/settings', { [item.key]: level }, expect.anything());
  }
});
