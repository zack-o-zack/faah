export type SettingValue = string | number | boolean;
export type SettingsValues = Record<string, SettingValue>;
export type SettingType = 'string' | 'number' | 'boolean' | 'select' | 'textarea';

export interface SettingItem {
  key: string;
  title: string;
  description: string;
  category: string;
  type: SettingType;
  default: SettingValue | null;
  options: string[];
  min?: number;
  max?: number;
  step?: number;
  secret: boolean;
}

/** GET /api/settings: the merged values, the schema and the file behind them. */
export interface SettingsReply {
  values: SettingsValues;
  defaults: SettingsValues;
  schema: SettingItem[];
  raw: string;
  path: string;
}

/** POST /api/settings: what the file holds after the write. */
export interface SavedSettings {
  values: SettingsValues;
  raw: string;
}

const SETTING_TYPES: readonly SettingType[] = ['string', 'number', 'boolean', 'select', 'textarea'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
function scalar(value: unknown): SettingValue | null {
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  return number(value) ?? null;
}

/** Only scalar values are settings the UI edits; nested maps (agent models) stay server-side. */
function values(value: unknown): SettingsValues {
  const result: SettingsValues = {};
  if (!isRecord(value)) return result;
  for (const [key, entry] of Object.entries(value)) {
    const parsed = scalar(entry);
    if (parsed !== null) result[key] = parsed;
  }
  return result;
}

function settingItem(value: unknown): SettingItem | null {
  if (!isRecord(value) || !text(value.key)) return null;
  const type = SETTING_TYPES.find((name) => name === value.type) ?? 'string';
  const options = Array.isArray(value.options)
    ? value.options.filter((option): option is string => typeof option === 'string')
    : [];
  return {
    key: text(value.key),
    title: text(value.title) || text(value.key),
    description: text(value.description),
    category: text(value.category) || 'General',
    type,
    default: scalar(value.default),
    options,
    min: number(value.min),
    max: number(value.max),
    step: number(value.step),
    secret: value.secret === true,
  };
}

export function parseSettingsReply(value: unknown): SettingsReply {
  if (!isRecord(value)) throw new Error('The server sent no settings.');
  const schema = Array.isArray(value.schema) ? value.schema.map(settingItem) : [];
  return {
    values: values(value.settings),
    defaults: values(value.defaults),
    schema: schema.filter((item): item is SettingItem => item !== null),
    raw: text(value.raw) || '{\n}\n',
    path: text(value.path),
  };
}

export function parseSavedSettings(value: unknown): SavedSettings {
  if (!isRecord(value)) throw new Error('The server did not confirm the save.');
  return { values: values(value.settings), raw: text(value.raw) };
}

export const COMMONLY_USED = 'Commonly Used';
const COMMON_KEYS = new Set([
  'editor.fontSize',
  'workbench.colorTheme',
  'editor.wordWrap',
  'editor.lineNumbers',
  'editor.vimMode',
  'editor.tabSize',
  'diffEditor.renderSideBySide',
  'editor.cursorStyle',
  'explorer.autoReveal',
  'search.smartCase',
  'lsp.hover.enabled',
  'agent.harness',
]);

export function categories(schema: SettingItem[]): string[] {
  return [COMMONLY_USED, ...new Set(schema.map((item) => item.category))];
}

/** A search covers every category; without one, the chosen category shows. */
export function visibleSettings(
  schema: SettingItem[],
  category: string,
  query: string,
): SettingItem[] {
  const needle = query.trim().toLowerCase();
  if (needle)
    return schema.filter((item) =>
      [item.title, item.key, item.description, item.category].some((field) =>
        field.toLowerCase().includes(needle),
      ),
    );
  if (category === COMMONLY_USED) return schema.filter((item) => COMMON_KEYS.has(item.key));
  return schema.filter((item) => item.category === category);
}

export function isModified(
  value: SettingValue | undefined,
  fallback: SettingValue | null,
): boolean {
  if (value === undefined) return false;
  if (fallback === null) return value !== '';
  if (typeof fallback === 'number') return Number(value) !== fallback;
  if (typeof fallback === 'boolean') return Boolean(value) !== fallback;
  return String(value) !== fallback;
}

export type SettingControl =
  | { kind: 'switch'; on: SettingValue; off: SettingValue }
  | { kind: 'segments'; options: string[] }
  | { kind: 'select'; options: { value: string; label: string }[] }
  | { kind: 'number'; presets: number[] }
  | { kind: 'textarea'; placeholder: string }
  | { kind: 'text'; secret: boolean };

const HARNESSES = ['claude', 'codex', 'agy', 'opencode', 'cursor-agent'];
const NUMBER_PRESETS: Record<string, number[]> = {
  'editor.fontSize': [12, 13, 13.5, 14, 16, 18],
  'editor.lineHeight': [18, 20, 21, 24, 28],
  'search.maxResults': [200, 500, 1000, 5000],
  'agent.timeoutSeconds': [60, 120, 180, 300],
};

/** Which control edits a setting: on/off choices are switches, short choices are segments. */
export function settingControl(item: SettingItem): SettingControl {
  if (item.type === 'boolean') return { kind: 'switch', on: true, off: false };
  if (item.key === 'agent.harness' || item.key === 'explain.agent') {
    const none = item.key === 'explain.agent' ? 'Use editing agent' : 'No agent';
    return {
      kind: 'select',
      options: [
        { value: '', label: none },
        ...HARNESSES.map((name) => ({ value: name, label: name })),
      ],
    };
  }
  if (item.type === 'select') {
    const options = item.options;
    if (options.length === 2 && options.includes('on') && options.includes('off'))
      return { kind: 'switch', on: 'on', off: 'off' };
    if (options.length <= 3) return { kind: 'segments', options };
    return { kind: 'select', options: options.map((option) => ({ value: option, label: option })) };
  }
  if (item.type === 'number') return { kind: 'number', presets: NUMBER_PRESETS[item.key] ?? [] };
  if (item.type === 'textarea')
    return {
      kind: 'textarea',
      placeholder:
        item.key === 'git.commitMessageInstruction'
          ? 'e.g. Follow Conventional Commits and reference the issue key from the branch name'
          : 'Enter instructions',
    };
  return { kind: 'text', secret: item.secret };
}

/** A segment's label read back as the setting's own type. */
export function segmentValue(item: SettingItem, option: string): SettingValue {
  return typeof item.default === 'number' ? Number(option) : option;
}

export type NumberInput = { ok: true; value: number } | { ok: false; error: string };

/** An out-of-range number is reported on its card and never saved. */
export function parseNumberInput(input: string, item: SettingItem): NumberInput {
  const value = Number.parseFloat(input);
  const outside =
    (item.min !== undefined && value < item.min) || (item.max !== undefined && value > item.max);
  if (!Number.isNaN(value) && !outside) return { ok: true, value };
  if (item.min !== undefined && item.max !== undefined)
    return { ok: false, error: `Enter a number from ${item.min} to ${item.max}.` };
  return { ok: false, error: 'Enter a valid number.' };
}

export function shownDefault(value: SettingValue | null): string {
  return value === null || value === '' ? 'empty' : String(value);
}

export type CursorStyle = 'line' | 'block' | 'underline';
export type CursorBlinking = 'smooth' | 'solid' | 'blink';

/** Everything the app derives from settings, with the server's defaults until they load. */
export interface Preferences {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
  wrap: boolean;
  lineNumbers: boolean;
  vim: boolean;
  cursorStyle: CursorStyle;
  cursorBlinking: CursorBlinking;
  lineHighlight: boolean;
  scrollBeyondLastLine: boolean;
  gitGutter: boolean;
  minimap: boolean;
  colorTheme: string;
  splitDiff: boolean;
  markdownPreview: boolean;
  tablePreview: boolean;
  hover: boolean;
  autoReveal: boolean;
}

const truthy = (value: SettingValue | undefined, fallback: boolean): boolean =>
  value === undefined ? fallback : value === true || value === 'true' || value === 'on';
const numeric = (value: SettingValue | undefined, fallback: number): number => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export function preferences(values: SettingsValues): Preferences {
  const cursor = values['editor.cursorStyle'];
  const blinking = values['editor.cursorBlinking'];
  return {
    fontSize: numeric(values['editor.fontSize'], 13.5),
    fontFamily: String(values['editor.fontFamily'] ?? ''),
    lineHeight: numeric(values['editor.lineHeight'], 21),
    tabSize: Math.round(numeric(values['editor.tabSize'], 4)),
    wrap: truthy(values['editor.wordWrap'], true),
    lineNumbers: truthy(values['editor.lineNumbers'], true),
    vim: truthy(values['editor.vimMode'], false),
    cursorStyle: cursor === 'block' || cursor === 'underline' ? cursor : 'line',
    cursorBlinking: blinking === 'solid' || blinking === 'blink' ? blinking : 'smooth',
    lineHighlight: values['editor.renderLineHighlight'] !== 'none',
    scrollBeyondLastLine: truthy(values['editor.scrollBeyondLastLine'], true),
    gitGutter: truthy(values['git.gutterIndicators'], true),
    minimap: truthy(values['editor.minimap.enabled'], true),
    colorTheme: String(values['workbench.colorTheme'] ?? ''),
    splitDiff: truthy(values['diffEditor.renderSideBySide'], true),
    markdownPreview: truthy(values['markdown.preview.open'], true),
    tablePreview: truthy(values['table.preview.open'], true),
    hover: truthy(values['lsp.enabled'], true) && truthy(values['lsp.hover.enabled'], true),
    autoReveal: truthy(values['explorer.autoReveal'], true),
  };
}

export const diffLayout = (prefs: Preferences): 'split' | 'unified' =>
  prefs.splitDiff ? 'split' : 'unified';

/** Body classes the editor stylesheet keys off. */
export function preferenceClasses(prefs: Preferences): Record<string, boolean> {
  return {
    'hide-lines': !prefs.lineNumbers,
    'cursor-block': prefs.cursorStyle === 'block',
    'cursor-underline': prefs.cursorStyle === 'underline',
    'cursor-blink-smooth': prefs.cursorBlinking === 'smooth',
    'cursor-blink-solid': prefs.cursorBlinking === 'solid',
    'no-line-highlight': !prefs.lineHighlight,
    'no-scroll-beyond': !prefs.scrollBeyondLastLine,
    'hide-git-gutter': !prefs.gitGutter,
  };
}

/** CSS custom properties for the editor's type. */
export function typographyVariables(prefs: Preferences): Record<string, string> {
  const variables: Record<string, string> = {
    '--fs': `${prefs.fontSize}px`,
    '--lh': `${prefs.lineHeight}px`,
    '--tab-size': String(prefs.tabSize),
  };
  if (prefs.fontFamily) variables['--mono'] = prefs.fontFamily;
  return variables;
}

export function validRawSettings(raw: string): string {
  try {
    JSON.parse(raw);
    return '';
  } catch (error) {
    return 'JSON Syntax Error: ' + (error instanceof Error ? error.message : String(error));
  }
}
