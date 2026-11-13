import { expect, test } from 'vitest';
import {
  COMMONLY_USED,
  categories,
  isModified,
  parseNumberInput,
  parseSavedSettings,
  parseSettingsReply,
  preferenceClasses,
  preferences,
  settingControl,
  typographyVariables,
  validRawSettings,
  visibleSettings,
  type SettingItem,
} from './logic.ts';

const item = (fields: Partial<SettingItem>): SettingItem => ({
  key: 'editor.fontSize',
  title: 'Font Size',
  description: 'Size of code text.',
  category: 'Text Editor',
  type: 'string',
  default: '',
  options: [],
  secret: false,
  ...fields,
});

test('the settings reply keeps scalar values and well-formed schema items only', () => {
  const reply = parseSettingsReply({
    settings: { 'editor.fontSize': 14, models: { claude: 'opus' }, 'editor.vimMode': true },
    defaults: { 'editor.fontSize': 13.5 },
    schema: [
      { key: 'editor.fontSize', type: 'number', min: 9, max: 32, default: 13.5 },
      { title: 'no key' },
      'junk',
      { key: 'editor.wordWrap', type: 'mystery', options: ['on', 3, 'off'] },
    ],
    path: '/home/me/.faah/settings.json',
  });
  expect(reply.values).toEqual({ 'editor.fontSize': 14, 'editor.vimMode': true });
  expect(reply.schema.map((entry) => entry.key)).toEqual(['editor.fontSize', 'editor.wordWrap']);
  expect(reply.schema[0]).toMatchObject({
    title: 'editor.fontSize',
    min: 9,
    max: 32,
    category: 'General',
  });
  expect(reply.schema[1]).toMatchObject({ type: 'string', options: ['on', 'off'] });
  expect(reply.raw).toBe('{\n}\n');
  expect(() => parseSettingsReply(null)).toThrow();
  expect(parseSavedSettings({ settings: { a: 'b' }, raw: '{}' })).toEqual({
    values: { a: 'b' },
    raw: '{}',
  });
});

test('searching spans categories; otherwise the category filters', () => {
  const schema = [
    item({ key: 'editor.fontSize', category: 'Text Editor' }),
    item({ key: 'git.gutterIndicators', title: 'Gutter', category: 'Git & Diff' }),
  ];
  expect(categories(schema)).toEqual([COMMONLY_USED, 'Text Editor', 'Git & Diff']);
  expect(visibleSettings(schema, COMMONLY_USED, '').map((entry) => entry.key)).toEqual([
    'editor.fontSize',
  ]);
  expect(visibleSettings(schema, 'Git & Diff', '')).toHaveLength(1);
  expect(visibleSettings(schema, 'Text Editor', 'GUTTER').map((entry) => entry.key)).toEqual([
    'git.gutterIndicators',
  ]);
});

test('a value is modified only when it differs from the default in the default’s type', () => {
  expect(isModified(undefined, 4)).toBe(false);
  expect(isModified('4', 4)).toBe(false);
  expect(isModified(8, 4)).toBe(true);
  expect(isModified('', null)).toBe(false);
  expect(isModified(true, false)).toBe(true);
});

test('controls follow the schema type and choice count', () => {
  expect(settingControl(item({ type: 'boolean' }))).toEqual({
    kind: 'switch',
    on: true,
    off: false,
  });
  expect(settingControl(item({ type: 'select', options: ['off', 'on'] }))).toEqual({
    kind: 'switch',
    on: 'on',
    off: 'off',
  });
  expect(settingControl(item({ type: 'select', options: ['2', '4', '8'] })).kind).toBe('segments');
  expect(settingControl(item({ type: 'select', options: ['a', 'b', 'c', 'd'] })).kind).toBe(
    'select',
  );
  expect(settingControl(item({ key: 'agent.harness' }))).toMatchObject({ kind: 'select' });
  expect(settingControl(item({ type: 'number' }))).toEqual({
    kind: 'number',
    presets: [12, 13, 13.5, 14, 16, 18],
  });
  expect(settingControl(item({ key: 'github.token', secret: true }))).toEqual({
    kind: 'text',
    secret: true,
  });
});

test('numbers outside the schema range are rejected with the range', () => {
  const size = item({ type: 'number', min: 9, max: 32 });
  expect(parseNumberInput('14.5', size)).toEqual({ ok: true, value: 14.5 });
  expect(parseNumberInput('40', size)).toEqual({
    ok: false,
    error: 'Enter a number from 9 to 32.',
  });
  expect(parseNumberInput('x', item({ type: 'number' }))).toEqual({
    ok: false,
    error: 'Enter a valid number.',
  });
});

test('preferences derive from values with the server defaults before load', () => {
  const defaults = preferences({});
  expect(defaults).toMatchObject({
    fontSize: 13.5,
    wrap: true,
    vim: false,
    splitDiff: true,
    hover: true,
  });
  const prefs = preferences({
    'editor.wordWrap': 'off',
    'editor.lineNumbers': 'off',
    'editor.tabSize': '8',
    'editor.cursorStyle': 'block',
    'lsp.enabled': false,
    'diffEditor.renderSideBySide': false,
    'editor.fontFamily': 'Iosevka',
  });
  expect(prefs).toMatchObject({
    wrap: false,
    lineNumbers: false,
    tabSize: 8,
    hover: false,
    splitDiff: false,
  });
  expect(preferenceClasses(prefs)).toMatchObject({ 'hide-lines': true, 'cursor-block': true });
  expect(typographyVariables(prefs)).toEqual({
    '--fs': '13.5px',
    '--lh': '21px',
    '--tab-size': '8',
    '--mono': 'Iosevka',
  });
});

test('raw settings must be JSON', () => {
  expect(validRawSettings('{"a": 1}')).toBe('');
  expect(validRawSettings('{a')).toMatch(/^JSON Syntax Error/);
});
