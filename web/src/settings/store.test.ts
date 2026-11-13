import { createRoot } from 'solid-js';
import { expect, test, vi } from 'vitest';
import { createSettingsStore, type SettingsOptions } from './store.ts';

vi.mock('../lib/toast.jsx', () => ({ toast: vi.fn() }));

const reply = () => ({
  settings: { 'editor.wordWrap': 'on', 'editor.fontSize': 13.5 },
  defaults: { 'editor.wordWrap': 'on', 'editor.fontSize': 13.5 },
  schema: [
    {
      key: 'editor.fontSize',
      title: 'Font Size',
      category: 'Text Editor',
      type: 'number',
      min: 9,
      max: 32,
    },
    {
      key: 'editor.wordWrap',
      title: 'Word Wrap',
      category: 'Text Editor',
      type: 'select',
      options: ['on', 'off'],
    },
  ],
  raw: '{}\n',
  path: '/tmp/settings.json',
});

function fixture(options: SettingsOptions) {
  let dispose = () => {};
  const settings = createRoot((release) => {
    dispose = release;
    return createSettingsStore(options);
  });
  return { settings, dispose };
}
const fields = (body: unknown): object => (typeof body === 'object' && body !== null ? body : {});
const echo = (body: unknown) => ({
  settings: { ...reply().settings, ...fields(body) },
  raw: '{"x":1}',
});

test('loading fills the schema, values and derived preferences', async () => {
  const { settings, dispose } = fixture({ request: async () => reply() });
  expect(settings.preferences().wrap).toBe(true);
  await settings.actions.loadSettings();
  expect(settings.state.path).toBe('/tmp/settings.json');
  expect(settings.categories()).toEqual(['Commonly Used', 'Text Editor']);
  dispose();
});

test('a switch saves at once and preferences follow; a failed save reports and keeps the value', async () => {
  let fail = false;
  const post = vi.fn(async (_path: string, body: unknown) => {
    if (fail) throw new Error('disk full');
    return echo(body);
  });
  const saved = vi.fn();
  const { settings, dispose } = fixture({ request: async () => reply(), post });
  settings.onSaved(saved);
  await settings.actions.loadSettings();
  const saving = settings.actions.setSetting('editor.wordWrap', 'off');
  expect(settings.preferences().wrap).toBe(false);
  expect(settings.state.save.status).toBe('saving');
  await saving;
  expect(settings.state.save).toEqual({ status: 'saved', message: 'All changes saved' });
  expect(settings.state.raw).toBe('{"x":1}');
  expect(saved).toHaveBeenCalledWith(['editor.wordWrap']);
  fail = true;
  await settings.actions.setSetting('editor.wordWrap', 'on');
  expect(settings.state.save).toEqual({ status: 'error', message: 'Failed to save: disk full' });
  dispose();
});

test('typed edits wait for Save; an out-of-range number never saves', async () => {
  const post = vi.fn(async (_path: string, body: unknown) => echo(body));
  const { settings, dispose } = fixture({ request: async () => reply(), post });
  await settings.actions.loadSettings();
  const size = settings.state.schema[0];
  if (!size) throw new Error('schema missing');
  settings.actions.commitNumber(size, '99');
  expect(settings.state.invalid['editor.fontSize']).toBe('Enter a number from 9 to 32.');
  expect(post).not.toHaveBeenCalled();
  settings.actions.editSetting('editor.fontFamily', 'Iosevka');
  expect(settings.state.save.status).toBe('unsaved');
  await settings.actions.saveSettings();
  expect(post).toHaveBeenCalledWith(
    'api/settings',
    { 'editor.fontFamily': 'Iosevka' },
    expect.anything(),
  );
  expect(settings.state.edits).toEqual({});
  expect(settings.state.save).toEqual({ status: 'saved', message: 'Settings saved successfully' });
  dispose();
});

test('the JSON view validates before saving the raw file', async () => {
  const post = vi.fn(async () => ({
    settings: { 'editor.vimMode': true },
    raw: '{"editor.vimMode":true}',
  }));
  const { settings, dispose } = fixture({ request: async () => reply(), post });
  settings.actions.openSettings('json');
  await vi.waitFor(() => expect(settings.state.dialog.raw).toBe('{}\n'));
  settings.actions.setRawSettings('{oops');
  await settings.actions.saveRawSettings();
  expect(settings.state.dialog.rawError).toMatch(/JSON Syntax Error/);
  expect(post).not.toHaveBeenCalled();
  settings.actions.setRawSettings('{"editor.vimMode":true}');
  await settings.actions.saveSettings();
  expect(post).toHaveBeenCalledWith(
    'api/settings',
    { raw: '{"editor.vimMode":true}' },
    expect.anything(),
  );
  expect(settings.preferences().vim).toBe(true);
  expect(settings.state.dialog.rawNotice).toBe('Settings saved successfully.');
  dispose();
});
