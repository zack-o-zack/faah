import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { SettingsProvider } from './context.ts';
import { SettingsDialog } from './SettingsDialog.tsx';
import { createSettingsStore, type SettingsStore } from './store.ts';

vi.mock('../lib/toast.tsx', () => ({ toast: vi.fn() }));

const reply = {
  settings: { 'editor.tabSize': 4, 'editor.vimMode': false },
  defaults: { 'editor.tabSize': 4, 'editor.vimMode': false, 'github.token': '' },
  schema: [
    {
      key: 'editor.tabSize',
      title: 'Tab Size',
      category: 'Text Editor',
      type: 'select',
      options: ['2', '4', '8'],
      default: 4,
    },
    {
      key: 'editor.vimMode',
      title: 'Vim Mode',
      category: 'Text Editor',
      type: 'boolean',
      default: false,
    },
    {
      key: 'github.token',
      title: 'GitHub Token',
      category: 'GitHub',
      type: 'string',
      secret: true,
      default: '',
    },
  ],
  raw: '{}\n',
  path: '/tmp/settings.json',
};

function mount() {
  const post = vi.fn(async (_path: string, body: unknown) => ({
    settings: { ...reply.settings, ...(typeof body === 'object' && body !== null ? body : {}) },
    raw: '{}',
  }));
  const vimHelp = vi.fn();
  let settings: SettingsStore | undefined;
  render(() => {
    const store = createSettingsStore({ request: async () => structuredClone(reply), post });
    settings = store;
    return (
      <SettingsProvider value={store}>
        <SettingsDialog onVimHelp={vimHelp} />
      </SettingsProvider>
    );
  });
  if (!settings) throw new Error('not mounted');
  return { settings, post, vimHelp };
}

test('opening on a category lists its settings and saves a segment choice', async () => {
  const { settings, post } = mount();
  settings.actions.openSettings('ui', 'Text Editor');
  await screen.findByText('Tab Size');
  fireEvent.click(screen.getByRole('button', { name: '8' }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('api/settings', { 'editor.tabSize': 8 }, expect.anything()),
  );
  expect(screen.getByText('Modified')).toBeTruthy();
});

test('search spans categories and the vim card links its cheat sheet', async () => {
  const { settings, vimHelp } = mount();
  settings.actions.openSettings();
  await waitFor(() => expect(settings.state.loaded).toBe(true));
  fireEvent.input(screen.getByRole('searchbox', { name: 'Search settings' }), {
    target: { value: 'token' },
  });
  expect(screen.getByText('GitHub Token')).toBeTruthy();
  expect(screen.queryByText('Tab Size')).toBe(null);
  fireEvent.input(screen.getByRole('searchbox', { name: 'Search settings' }), {
    target: { value: 'vim' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Vim keybindings cheat sheet' }));
  expect(vimHelp).toHaveBeenCalled();
});

test('a switch saves its boolean and the JSON view shows the file', async () => {
  const { settings, post } = mount();
  settings.actions.openSettings('ui', 'Text Editor');
  fireEvent.click(await screen.findByRole('switch', { name: 'Vim Mode' }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      'api/settings',
      { 'editor.vimMode': true },
      expect.anything(),
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
  expect(screen.getByRole('textbox', { name: 'Settings JSON' })).toHaveProperty('value', '{}');
});
