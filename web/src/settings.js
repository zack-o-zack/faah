import { setPressed } from './controls.js';
// web/src/settings.js
import { $, $$, esc, S, api, apiPost, apiPostJson } from './state.js';
import { showToast } from './ui.js';
import { applyEditorTypography, toggleWordWrap, toggleLineNumbers } from './renderer.js';
import { setTheme, listThemes } from './theme.js';
import { chooseThemePreference, DEFAULT_THEME } from './theme-preference.js';
import { setLayoutPref } from './diff.js';
import { setVimModeEnabled, showVimHelp } from './vim.js';

export let settingsModalEl = null;
const BUILTIN_SCHEMA = [
  {
    key: "editor.fontSize",
    title: "Font Size",
    description: "Controls the font size in pixels for the code viewer.",
    category: "Text Editor",
    type: "number",
    default: 13.5,
    min: 9.0,
    max: 32.0,
    step: 0.5
  },
  {
    key: "editor.fontFamily",
    title: "Font Family",
    description: "Controls the font family used in the code viewer.",
    category: "Text Editor",
    type: "string",
    default: '"JetBrains Mono", "Fira Code", "Cascadia Code", "SF Mono", Menlo, Consolas, ui-monospace, monospace'
  },
  {
    key: "editor.lineHeight",
    title: "Line Height",
    description: "Controls the line height in pixels for the code viewer.",
    category: "Text Editor",
    type: "number",
    default: 21.0,
    min: 14.0,
    max: 48.0,
    step: 1.0
  },
  {
    key: "editor.tabSize",
    title: "Tab Size",
    description: "The number of spaces a tab is equal to.",
    category: "Text Editor",
    type: "select",
    default: 4,
    options: ["2", "4", "8"]
  },
  {
    key: "editor.wordWrap",
    title: "Word Wrap",
    description: "Controls whether lines should wrap around or scroll horizontally.",
    category: "Text Editor",
    type: "select",
    default: "on",
    options: ["on", "off"]
  },
  {
    key: "editor.lineNumbers",
    title: "Line Numbers",
    description: "Controls the display of line numbers in the gutter.",
    category: "Text Editor",
    type: "select",
    default: "on",
    options: ["on", "off"]
  },
  {
    key: "editor.vimMode",
    title: "Vim Keybindings",
    description: "Enable Vim modal navigation (Normal mode, Visual mode, motions, search, and LSP shortcuts).",
    category: "Text Editor",
    type: "boolean",
    default: false
  },
  {
    key: "editor.cursorStyle",
    title: "Cursor Style",
    description: "Controls the cursor style in the code viewer.",
    category: "Text Editor",
    type: "select",
    default: "line",
    options: ["line", "block", "underline"]
  },
  {
    key: "editor.cursorBlinking",
    title: "Cursor Blinking",
    description: "Controls the cursor animation style.",
    category: "Text Editor",
    type: "select",
    default: "smooth",
    options: ["blink", "smooth", "solid"]
  },
  {
    key: "editor.renderLineHighlight",
    title: "Render Line Highlight",
    description: "Controls how the editor should render the current line highlight.",
    category: "Text Editor",
    type: "select",
    default: "line",
    options: ["line", "none"]
  },
  {
    key: "editor.occurrencesHighlight",
    title: "Occurrences Highlight",
    description: "Controls whether the editor should highlight occurrences of the selected word.",
    category: "Text Editor",
    type: "boolean",
    default: true
  },
  {
    key: "editor.scrollBeyondLastLine",
    title: "Scroll Beyond Last Line",
    description: "Controls whether the editor will scroll beyond the last line of the file.",
    category: "Text Editor",
    type: "boolean",
    default: true
  },
  {
    key: "editor.bracketPairColorization",
    title: "Bracket Pair Colorization",
    description: "Controls whether bracket pair colorization and matching is enabled.",
    category: "Text Editor",
    type: "boolean",
    default: true
  },
  {
    key: "editor.renderWhitespace",
    title: "Render Whitespace",
    description: "Controls how whitespace characters are rendered in the viewer.",
    category: "Text Editor",
    type: "select",
    default: "selection",
    options: ["none", "boundary", "selection", "all"]
  },
  {
    key: "editor.minimap.enabled",
    title: "Minimap Hits",
    description: "Controls whether search hit indicators are shown in the scroll minimap gutter.",
    category: "Text Editor",
    type: "boolean",
    default: true
  },
  {
    key: "workbench.colorTheme",
    title: "Color Theme",
    description: "Specifies the color theme used in the workbench.",
    category: "Workbench",
    type: "select",
    default: "catppuccin-mocha",
    options: [
      "catppuccin-mocha", "catppuccin-latte",
      "github-dark", "dark", "light",
      "dracula", "gruvbox-dark", "gruvbox-light",
      "monokai", "nord", "one-dark", "rose-pine",
      "solarized-dark", "solarized-light"
    ]
  },
  {
    key: "diffEditor.renderSideBySide",
    title: "Diff Side By Side",
    description: "Controls whether the diff editor shows changes in split (side-by-side) or unified mode.",
    category: "Workbench",
    type: "boolean",
    default: true
  },
  {
    key: "diffEditor.ignoreTrimWhitespace",
    title: "Diff: Ignore Trim Whitespace",
    description: "Controls whether the diff viewer ignores changes in leading or trailing whitespace.",
    category: "Git & Diff",
    type: "boolean",
    default: true
  },
  {
    key: "git.gutterIndicators",
    title: "Git Gutter Indicators",
    description: "Controls whether changed line indicators are shown in the editor gutter.",
    category: "Git & Diff",
    type: "boolean",
    default: true
  },
  {
    key: "markdown.preview.open",
    title: "Markdown Preview",
    description: "Controls whether Markdown files open in rendered preview by default.",
    category: "Workbench",
    type: "boolean",
    default: true
  },
  {
    key: "table.preview.open",
    title: "Table View",
    description: "Controls whether CSV and TSV files open as a table by default.",
    category: "Workbench",
    type: "boolean",
    default: true
  },
  {
    key: "explorer.compactFolders",
    title: "Compact Folders",
    description: "Controls whether the file tree renders single-child directory chains compactly.",
    category: "Files & Explorer",
    type: "boolean",
    default: true
  },
  {
    key: "explorer.autoReveal",
    title: "Auto Reveal",
    description: "Controls whether the file explorer automatically scrolls to and reveals active tabs.",
    category: "Files & Explorer",
    type: "boolean",
    default: true
  },
  {
    key: "files.exclude",
    title: "Files Exclude Patterns",
    description: "Configure glob patterns for excluding files and folders from search and trees.",
    category: "Files & Explorer",
    type: "string",
    default: "**/.git, **/node_modules, **/target, **/.DS_Store"
  },
  {
    key: "search.smartCase",
    title: "Smart Case Search",
    description: "Searches case-insensitively when query is lowercase, and case-sensitively when uppercase characters exist.",
    category: "Search",
    type: "boolean",
    default: true
  },
  {
    key: "search.maxResults",
    title: "Max Search Results",
    description: "Controls the maximum number of results returned in workspace-wide searches.",
    category: "Search",
    type: "number",
    default: 1000.0,
    min: 50.0,
    max: 10000.0,
    step: 50.0
  },
  {
    key: "lsp.enabled",
    title: "Language Server Protocol (LSP)",
    description: "Master switch for language server integrations (definitions, references, diagnostics).",
    category: "LSP & Intelligence",
    type: "boolean",
    default: true
  },
  {
    key: "lsp.hover.enabled",
    title: "Hover Documentation",
    description: "Controls whether hovercards with documentation and type signatures appear on hover.",
    category: "LSP & Intelligence",
    type: "boolean",
    default: true
  },
  {
    key: "agent.harness",
    title: "Coding Harness",
    description: "Coding agent harness invoked for code edits (e.g. claude, codex, agy, opencode, cursor-agent).",
    category: "Agent / AI",
    type: "string",
    default: ""
  },
  {
    key: "agent.timeoutSeconds",
    title: "Agent Timeout (Seconds)",
    description: "Controls the maximum execution time in seconds for agent edits before canceling.",
    category: "Agent / AI",
    type: "number",
    default: 120.0,
    min: 10.0,
    max: 600.0,
    step: 10.0
  },
  {
    key: "agent.autoAcceptEdits",
    title: "Auto Accept Agent Edits",
    description: "Controls whether agent-generated code diffs are accepted without manual confirmation.",
    category: "Agent / AI",
    type: "boolean",
    default: false
  },
  {
    key: "server.basePath",
    title: "Base Path",
    description: "Base URL path prefix for the faah server and web interface (e.g. /rev-123/).",
    category: "Server",
    type: "string",
    default: "/"
  },
  {
    key: "tips.enabled",
    title: "Show Tips in Interface",
    description: "Controls whether faah periodically shows helpful tips and tricks in the interface.",
    category: "General",
    type: "boolean",
    default: true
  }
];

let settingsData = {
  settings: {},
  defaults: Object.fromEntries(BUILTIN_SCHEMA.map(s => [s.key, s.default])),
  schema: BUILTIN_SCHEMA,
  raw: '{\n}\n',
  path: '~/.faah/settings.json'
};
let activeSettingsCategory = 'Commonly Used';
let settingsViewMode = 'ui'; // 'ui' | 'json'
let settingsFilterQuery = '';

const COMMONLY_USED_KEYS = new Set([
  'editor.fontSize',
  'workbench.colorTheme',
  'editor.wordWrap',
  'editor.lineNumbers',
  'editor.vimMode',
  'editor.tabSize',
  'diffEditor.renderSideBySide',
  'editor.cursorStyle',
  'explorer.autoReveal',
  'explorer.autoRelveal',
  'search.smartCase',
  'lsp.hover.enabled',
  'agent.harness',
]);

export function isAutoRevealEnabled() {
  if (S.settings) {
    if (S.settings['explorer.autoReveal'] !== undefined) {
      return S.settings['explorer.autoReveal'] === true || S.settings['explorer.autoReveal'] === 'true';
    }
    if (S.settings['explorer.autoRelveal'] !== undefined) {
      return S.settings['explorer.autoRelveal'] === true || S.settings['explorer.autoRelveal'] === 'true';
    }
    if (S.settings['autoReveal'] !== undefined) {
      return S.settings['autoReveal'] === true || S.settings['autoReveal'] === 'true';
    }
    if (S.settings['autoRelveal'] !== undefined) {
      return S.settings['autoRelveal'] === true || S.settings['autoRelveal'] === 'true';
    }
  }
  return true;
}

export async function loadSettings() {
  try {
    const data = await api('/api/settings');
    if (data && data.schema && data.schema.length > 0) {
      settingsData = data;
    } else if (data) {
      settingsData.settings = data.settings || {};
      settingsData.raw = data.raw || settingsData.raw;
      settingsData.path = data.path || settingsData.path;
      if (data.defaults) settingsData.defaults = { ...settingsData.defaults, ...data.defaults };
    }
    S.settings = settingsData.settings || {};
    return settingsData;
  } catch (err) {
    console.warn('Using built-in settings schema (offline/fallback):', err);
    return settingsData;
  }
}

export function applySettingLive(key, val) {
  if (!S.settings) S.settings = {};
  S.settings[key] = val;

  switch (key) {
    case 'editor.fontSize':
    case 'editor.fontFamily':
    case 'editor.lineHeight':
    case 'editor.tabSize': {
      const fs = parseFloat(S.settings['editor.fontSize']) || 13.5;
      const ff = S.settings['editor.fontFamily'] || '';
      const lh = parseFloat(S.settings['editor.lineHeight']) || 21.0;
      const ts = parseInt(S.settings['editor.tabSize'], 10) || 4;
      applyEditorTypography(fs, ff, lh, ts);
      break;
    }
    case 'editor.wordWrap': {
      const on = val === 'on' || val === true;
      toggleWordWrap(on);
      break;
    }
    case 'editor.lineNumbers': {
      const on = val === 'on' || val === true;
      toggleLineNumbers(on);
      break;
    }
    case 'editor.cursorStyle': {
      document.body.classList.remove('cursor-block', 'cursor-underline');
      if (val === 'block') document.body.classList.add('cursor-block');
      else if (val === 'underline') document.body.classList.add('cursor-underline');
      break;
    }
    case 'editor.cursorBlinking': {
      document.body.classList.remove('cursor-blink-smooth', 'cursor-blink-solid', 'cursor-blink-blink');
      if (val === 'solid') document.body.classList.add('cursor-blink-solid');
      else if (val === 'blink') document.body.classList.add('cursor-blink-blink');
      else document.body.classList.add('cursor-blink-smooth');
      break;
    }
    case 'editor.renderLineHighlight': {
      document.body.classList.toggle('no-line-highlight', val === 'none');
      break;
    }
    case 'editor.scrollBeyondLastLine': {
      document.body.classList.toggle('no-scroll-beyond', val === false || val === 'false');
      break;
    }
    case 'git.gutterIndicators': {
      document.body.classList.toggle('hide-git-gutter', val === false || val === 'false');
      break;
    }
    case 'editor.minimap.enabled': {
      const minimap = $('#minimap-hits');
      if (minimap) minimap.style.display = (val === false || val === 'false') ? 'none' : '';
      break;
    }
    case 'workbench.colorTheme': {
      const storedTheme = localStorage.getItem('faah.theme');
      const nextTheme = chooseThemePreference(storedTheme, val, DEFAULT_THEME);
      if (nextTheme) setTheme(nextTheme, false);
      break;
    }
    case 'diffEditor.renderSideBySide': {
      const split = val === true || val === 'true';
      setLayoutPref(split ? 'split' : 'unified');
      break;
    }
    case 'markdown.preview.open': {
      S.mdPreview = val === true || val === 'true';
      try { localStorage.setItem('faah.mdPreview', S.mdPreview ? 'true' : 'false'); } catch {}
      break;
    }
    case 'table.preview.open': {
      S.tablePreview = val === true || val === 'true';
      try { localStorage.setItem('faah.tablePreview', S.tablePreview ? 'true' : 'false'); } catch {}
      break;
    }
    case 'editor.vimMode': {
      setVimModeEnabled(val === true || val === 'true', false);
      break;
    }
    case 'explorer.autoReveal':
    case 'explorer.autoRelveal':
    case 'autoReveal':
    case 'autoRelveal': {
      const on = val === true || val === 'true';
      S.settings['explorer.autoReveal'] = on;
      S.settings['explorer.autoRelveal'] = on;
      break;
    }
  }
}

export function applyAllSettingsLive() {
  if (!S.settings) return;
  let needTypography = false;
  for (const [k, v] of Object.entries(S.settings)) {
    if (k === 'editor.fontSize' || k === 'editor.fontFamily' || k === 'editor.lineHeight' || k === 'editor.tabSize') {
      needTypography = true;
      continue;
    }
    applySettingLive(k, v);
  }
  if (needTypography) {
    const fs = parseFloat(S.settings['editor.fontSize']) || 13.5;
    const ff = S.settings['editor.fontFamily'] || '';
    const lh = parseFloat(S.settings['editor.lineHeight']) || 21.0;
    const ts = parseInt(S.settings['editor.tabSize'], 10) || 4;
    applyEditorTypography(fs, ff, lh, ts);
  }
}

export function openSettings(mode = 'ui', category = null, highlightKey = null) {
  if (!settingsModalEl) initSettingsDOM();
  settingsViewMode = mode === 'json' ? 'json' : 'ui';
  settingsModalEl.showModal();
  pendingSettingsChanges = {};
  setSaveStatus('saved', 'All changes saved');

  if (category && settingsViewMode === 'ui') {
    activeSettingsCategory = category;
    settingsFilterQuery = '';
    const searchInput = $('#settings-search');
    if (searchInput) searchInput.value = '';
  }

  // Immediately render with current schema & settings
  updateSettingsHeader();
  if (settingsViewMode === 'json') {
    showSettingsJSONView();
  } else {
    showSettingsUIView();
  }

  // Refresh with latest settings from server
  loadSettings().then(() => {
    updateSettingsHeader();
    if (settingsViewMode === 'json') {
      showSettingsJSONView();
    } else {
      showSettingsUIView();
    }
    if (highlightKey && settingsViewMode === 'ui') {
      focusSettingCard(highlightKey);
    }
  });

  const searchInput = $('#settings-search');
  if (searchInput && settingsViewMode === 'ui' && !category) {
    setTimeout(() => searchInput.focus(), 50);
  }

  if (highlightKey && settingsViewMode === 'ui') {
    setTimeout(() => focusSettingCard(highlightKey), 30);
  }
}

function focusSettingCard(key) {
  const card = settingsModalEl?.querySelector(`[data-setting="${key}"]`);
  if (card) {
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const input = card.querySelector('textarea, input, select');
    if (input) input.focus();
  }
}

export function closeSettings() {
  if (settingsModalEl) settingsModalEl.close();
}

export function isSettingsOpen() {
  return settingsModalEl && settingsModalEl.open;
}

function updateSettingsHeader() {
  const pathEl = $('#settings-path');
  if (pathEl && settingsData.path) {
    pathEl.textContent = settingsData.path;
    pathEl.title = 'Click to copy path: ' + settingsData.path;
  }
  const btnUI = $('#settings-mode-ui');
  const btnJSON = $('#settings-mode-json');
  if (btnUI && btnJSON) {
    setPressed(btnUI, settingsViewMode === 'ui');
    setPressed(btnJSON, settingsViewMode === 'json');
  }
}

function showSettingsUIView() {
  settingsViewMode = 'ui';
  updateSettingsHeader();
  $('#settings-ui-container').hidden = false;
  $('#settings-json-container').hidden = true;
  $('#settings-search-bar').hidden = false;
  renderSettingsNav();
  renderSettingsList();
}

function showSettingsJSONView() {
  settingsViewMode = 'json';
  updateSettingsHeader();
  $('#settings-ui-container').hidden = true;
  $('#settings-json-container').hidden = false;
  $('#settings-search-bar').hidden = true;

  const rawEditor = $('#settings-raw-editor');
  if (rawEditor) {
    rawEditor.value = settingsData.raw || '{\n}\n';
    rawEditor.focus();
  }
  const errEl = $('#settings-raw-error');
  if (errEl) errEl.hidden = true;
}

function getSettingCategories() {
  const cats = ['Commonly Used'];
  const seen = new Set(cats);
  for (const item of (settingsData.schema || [])) {
    const cat = item.category || item.Category;
    if (cat && !seen.has(cat)) {
      cats.push(cat);
      seen.add(cat);
    }
  }
  return cats;
}

function renderSettingsNav() {
  const nav = $('#settings-nav');
  if (!nav) return;
  const cats = getSettingCategories();
  nav.innerHTML = cats.map(cat => {
    const active = cat === activeSettingsCategory ? ' active' : '';
    return `<button aria-pressed="${!!active}" data-variant="${active ? 'secondary' : 'ghost'}" data-cat="${esc(cat)}" class="btn w-full justify-start aria-pressed:text-primary-text" data-control="settings-nav-item" data-size="xs">${esc(cat)}</button>`;
  }).join('');
}

/** A switch saves a boolean, or its on/off strings when the setting is an on/off choice. */
function switchValue(input) {
  if (input.dataset.on === undefined) return input.checked;
  return input.checked ? input.dataset.on : input.dataset.off;
}

function isSettingModified(key, val, defVal) {
  if (val === undefined || val === null) return false;
  if (defVal === undefined || defVal === null) return val !== '';
  if (typeof defVal === 'number') {
    return Number(val) !== Number(defVal);
  }
  if (typeof defVal === 'boolean') {
    return Boolean(val) !== Boolean(defVal);
  }
  return String(val) !== String(defVal);
}

function renderSettingsList() {
  const container = $('#settings-list');
  if (!container) return;

  const q = settingsFilterQuery.trim().toLowerCase();
  const schema = settingsData.schema || [];
  const currentSettings = settingsData.settings || {};
  const defaults = settingsData.defaults || {};

  let items = schema;
  if (q) {
    items = schema.filter(s => {
      const title = (s.title || s.Title || '').toLowerCase();
      const key = (s.key || s.Key || '').toLowerCase();
      const desc = (s.description || s.Description || '').toLowerCase();
      const cat = (s.category || s.Category || '').toLowerCase();
      const isAutoReveal = key === 'explorer.autoreveal' || key === 'explorer.autorelveal';
      const matchTypo = isAutoReveal && (q.includes('relveal') || q.includes('reveal'));
      return title.includes(q) || key.includes(q) || desc.includes(q) || cat.includes(q) || matchTypo;
    });
  } else if (activeSettingsCategory === 'Commonly Used') {
    items = schema.filter(s => COMMONLY_USED_KEYS.has(s.key || s.Key));
  } else {
    items = schema.filter(s => (s.category || s.Category) === activeSettingsCategory);
  }

  if (items.length === 0) {
    container.innerHTML = `<div data-ui="settings-empty" class="empty text-center p-3 text-muted-foreground">No matching settings found for "${esc(q || activeSettingsCategory)}".</div>`;
    return;
  }

  const html = items.map(item => {
    const key = item.key || item.Key;
    const title = item.title || item.Title || key;
    const desc = item.description || item.Description || '';
    const cat = item.category || item.Category || 'General';
    const type = item.type || item.Type || 'string';
    const itemDef = item.default !== undefined ? item.default : item.Default;
    const def = defaults[key] !== undefined ? defaults[key] : itemDef;
    const val = currentSettings[key] !== undefined ? currentSettings[key] : def;
    const modified = isSettingModified(key, currentSettings[key], def);

    const segment = (value, label, selected) => `<button type="button" aria-pressed="${selected}" data-variant="${selected ? 'secondary' : 'outline'}" data-set-key="${esc(key)}" data-set-val="${esc(String(value))}" class="btn" data-control="settings-pill-tag" data-size="sm">${esc(String(label))}</button>`;

    let controlHtml = '';
    let belowHtml = '';

    if (type === 'boolean') {
      const checked = (val === true || val === 'true') ? 'checked' : '';
      controlHtml = `<input aria-label="${esc(title)}" role="switch" type="checkbox" id="setting-${esc(key)}" data-key="${esc(key)}" ${checked} class="input">`;
    } else if (type === 'select') {
      const opts = item.options || item.Options || [];
      if (opts.length === 2 && opts.includes('on') && opts.includes('off')) {
        controlHtml = `<input aria-label="${esc(title)}" role="switch" type="checkbox" id="setting-${esc(key)}" data-key="${esc(key)}" data-on="on" data-off="off" ${val === 'on' ? 'checked' : ''} class="input">`;
      } else if (opts.length <= 3) {
        controlHtml = `<div class="button-group" role="group" aria-label="${esc(title)}">${opts.map(o => segment(o, o, String(o) === String(val))).join('')}</div>`;
      } else {
        const optHtml = opts.map(o => `<option value="${esc(o)}" ${String(o) === String(val) ? 'selected' : ''}>${esc(o)}</option>`).join('');
        controlHtml = `<select id="setting-${esc(key)}" data-key="${esc(key)}" class="select w-48" data-control="settings-select">${optHtml}</select>`;
      }
    } else if (type === 'number') {
      const min = item.min !== undefined ? item.min : item.Min;
      const max = item.max !== undefined ? item.max : item.Max;
      const step = item.step !== undefined ? item.step : item.Step;
      const minAttr = min !== undefined ? `min="${min}"` : '';
      const maxAttr = max !== undefined ? `max="${max}"` : '';
      const stepAttr = step !== undefined ? `step="${step}"` : 'step="1"';
      controlHtml = `<input type="number" id="setting-${esc(key)}" data-key="${esc(key)}" value="${esc(String(val))}" ${minAttr} ${maxAttr} ${stepAttr} class="input w-24 text-right tabular-nums" data-control="settings-input settings-input-num">`;

      let numberPresets = [];
      if (key === 'editor.fontSize') numberPresets = [12, 13, 13.5, 14, 16, 18];
      else if (key === 'editor.lineHeight') numberPresets = [18, 20, 21, 24, 28];
      else if (key === 'search.maxResults') numberPresets = [200, 500, 1000, 5000];
      else if (key === 'agent.timeoutSeconds') numberPresets = [60, 120, 180, 300];
      if (numberPresets.length) {
        belowHtml = `<div class="button-group mt-2" role="group" aria-label="${esc(title)} presets">${numberPresets.map(n => segment(n, n, Number(val) === n)).join('')}</div>`;
      }
    } else if (['agent.harness', 'explain.agent'].includes(key)) {
      const names = ['', 'claude', 'codex', 'agy', 'opencode', 'cursor-agent'];
      controlHtml = `<select id="setting-${esc(key)}" data-key="${esc(key)}" class="select w-48" data-control="settings-select">${names.map(name => `<option value="${name}"${String(val || '') === name ? ' selected' : ''}>${name || (key === 'explain.agent' ? 'Use editing agent' : 'No agent')}</option>`).join('')}</select>`;
    } else if (type === 'textarea') {
      const placeholder = key === 'git.commitMessageInstruction'
        ? 'e.g. Follow Conventional Commits and reference the issue key from the branch name'
        : 'Enter instructions';
      belowHtml = `<textarea id="setting-${esc(key)}" data-key="${esc(key)}" rows="5" spellcheck="false" placeholder="${esc(placeholder)}" class="textarea mt-2 w-full resize-y font-mono text-xs" data-control="settings-input settings-textarea">${esc(String(val || ''))}</textarea>`;
    } else {
      const isSecret = item.secret || item.Secret;
      controlHtml = `<input type="${isSecret ? 'password' : 'text'}" id="setting-${esc(key)}" data-key="${esc(key)}" value="${esc(String(val || ''))}"${isSecret ? ' autocomplete="off"' : ''} class="input w-64" data-control="settings-input">`;
    }

    const shownDefault = def === '' || def === undefined || def === null ? 'empty' : String(def);
    const resetBtn = modified
      ? `<button type="button" data-reset="${esc(key)}" title="Reset to default (${esc(shownDefault)})" class="btn" data-control="settings-reset-btn" data-variant="ghost" data-size="sm">Reset</button>`
      : '';

    const extraAction = (key === 'editor.vimMode') ? `
      <button type="button" class="btn self-start -ml-2 mt-1" data-control="settings-btn-link btn-vim-cheatsheet-trigger" title="Also opens with ? in Normal mode" data-variant="link" data-size="sm">
        Vim keybindings cheat sheet
      </button>` : '';

    return `
      <div data-ui="settings-card" class="field gap-6 border-b border-border py-4 last:border-b-0" data-orientation="horizontal" data-setting="${esc(key)}">
        <section data-ui="settings-card-left" class="min-w-0 gap-1">
          <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <label for="setting-${esc(key)}" class="label">${esc(title)}</label>
            <code class="font-mono text-xs text-muted-foreground">${esc(key)}</code>
            ${modified ? '<span class="badge" data-variant="outline">Modified</span>' : ''}
          </div>
          <p class="text-sm text-muted-foreground">${esc(desc)}</p>
          ${belowHtml}
          ${extraAction}
        </section>
        <div data-ui="settings-card-right" class="flex shrink-0 items-center gap-2">
          ${resetBtn}
          ${controlHtml}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

let pendingSettingsChanges = {};

function setSaveStatus(state, msg) {
  const statusEl = $('#settings-footer-status');
  const statusText = $('#settings-status-text');
  const statusIcon = $('#settings-status-icon');
  const saveBtn = $('#btn-settings-save');
  const saveLabel = $('#settings-btn-save-label');
  if (!statusEl || !statusText) return;

  statusEl.setAttribute('data-ui', 'settings-footer-status'); statusEl.className = 'flex items-center gap-2 text-muted-foreground [&.is-saved]:text-gi [&.is-error]:text-destructive [&.is-unsaved]:text-warn [&.is-saving]:text-primary-text';

  if (state === 'saving') {
    statusEl.classList.add('is-saving');
    statusText.textContent = msg || 'Saving changes...';
    if (statusIcon) {
      statusIcon.className = 'icon-[lucide--loader-circle] size-3.5 shrink-0 animate-spin';
    }
    if (saveBtn) saveBtn.disabled = true;
    if (saveLabel) saveLabel.textContent = 'Saving...';
  } else if (state === 'saved') {
    statusEl.classList.add('is-saved');
    statusText.textContent = msg || 'All changes saved';
    if (statusIcon) {
      statusIcon.className = 'icon-[lucide--check] size-3.5 shrink-0';
    }
    if (saveBtn) {
      // Nothing left to save until the next edit.
      saveBtn.disabled = true;
      const saveIcon = saveBtn.querySelector('.settings-btn-save-icon');
      if (saveIcon) saveIcon.className = 'icon-[lucide--check] size-3.5 shrink-0 settings-btn-save-icon';
      if (saveLabel) saveLabel.textContent = 'Saved';
      setTimeout(() => {
        if (saveIcon) {
          saveIcon.className = 'icon-[lucide--save] size-3.5 shrink-0 settings-btn-save-icon';
        }
        if (saveLabel) saveLabel.textContent = 'Save';
      }, 2000);
    }
  } else if (state === 'unsaved') {
    statusEl.classList.add('is-unsaved');
    statusText.textContent = msg || 'Unsaved changes';
    if (statusIcon) {
      statusIcon.className = 'icon-[lucide--circle-dot] size-3.5 shrink-0';
    }
    if (saveBtn) {
      saveBtn.disabled = false;
      const saveIcon = saveBtn.querySelector('.settings-btn-save-icon');
      if (saveIcon) {
        saveIcon.className = 'icon-[lucide--save] size-3.5 shrink-0 settings-btn-save-icon';
      }
      if (saveLabel) saveLabel.textContent = 'Save';
    }
  } else if (state === 'error') {
    statusEl.classList.add('is-error');
    statusText.textContent = msg || 'Failed to save';
    if (statusIcon) {
      statusIcon.className = 'icon-[lucide--circle-alert] size-3.5 shrink-0';
    }
    if (saveBtn) {
      saveBtn.disabled = false;
      if (saveLabel) saveLabel.textContent = 'Retry Save';
    }
  }
}

async function handleSettingChange(key, value) {
  // Update state locally
  if (!settingsData.settings) settingsData.settings = {};
  settingsData.settings[key] = value;
  delete pendingSettingsChanges[key];
  applySettingLive(key, value);

  // Re-render setting card modified state
  renderSettingsList();

  // Persist to server
  try {
    setSaveStatus('saving');
    const res = await apiPostJson('/api/settings', { [key]: value });
    if (res.raw) settingsData.raw = res.raw;
    setSaveStatus('saved', 'All changes saved');
  } catch (err) {
    console.error(`Failed to save setting ${key}:`, err);
    setSaveStatus('error', 'Failed to save: ' + (err.message || 'unknown error'));
  }
}

async function handleResetSetting(key) {
  const def = settingsData.defaults ? settingsData.defaults[key] : undefined;
  if (def !== undefined) {
    await handleSettingChange(key, def);
  }
}

async function handleExplicitSave() {
  if (settingsViewMode === 'json') {
    return handleSaveRawSettings();
  }

  // Capture value of currently focused input/textarea inside settings list if any
  const activeEl = /** @type {HTMLInputElement|HTMLTextAreaElement|null} */ (document.activeElement);
  if (activeEl && activeEl.dataset?.key && activeEl.closest('#settings-list')) {
    const key = activeEl.dataset.key;
    let val = /** @type {any} */ (activeEl.value);
    if (activeEl instanceof HTMLInputElement && activeEl.type === 'checkbox') val = switchValue(activeEl);
    else if (activeEl.type === 'number') val = parseFloat(val);
    pendingSettingsChanges[key] = val;
  }

  // Apply any pending changes locally
  for (const [k, v] of Object.entries(pendingSettingsChanges)) {
    if (!settingsData.settings) settingsData.settings = {};
    settingsData.settings[k] = v;
    applySettingLive(k, v);
  }

  setSaveStatus('saving');

  try {
    const toSave = Object.keys(pendingSettingsChanges).length > 0
      ? { ...pendingSettingsChanges }
      : { ...(settingsData.settings || {}) };

    const res = await apiPostJson('/api/settings', toSave);
    if (res.settings) {
      settingsData.settings = res.settings;
      S.settings = res.settings;
      applyAllSettingsLive();
    }
    if (res.raw) settingsData.raw = res.raw;
    pendingSettingsChanges = {};
    renderSettingsList();

    setSaveStatus('saved', 'Settings saved successfully');
    showToast('success', 'Settings saved');
  } catch (err) {
    setSaveStatus('error', 'Failed to save: ' + (err.message || 'unknown error'));
    showToast('error', err.message || 'Failed to save settings');
  }
}

async function handleSaveRawSettings() {
  const rawEditor = $('#settings-raw-editor');
  const errEl = $('#settings-raw-error');
  if (!rawEditor) return;

  const rawText = rawEditor.value;
  try {
    JSON.parse(rawText);
    if (errEl) errEl.hidden = true;
  } catch (err) {
    if (errEl) {
      errEl.textContent = 'JSON Syntax Error: ' + err.message;
      errEl.hidden = false;
    }
    setSaveStatus('error', 'JSON syntax error');
    return;
  }

  setSaveStatus('saving');
  try {
    const res = await apiPostJson('/api/settings', { raw: rawText });
    if (res.settings) {
      settingsData.settings = res.settings;
      S.settings = res.settings;
      applyAllSettingsLive();
    }
    if (res.raw) settingsData.raw = res.raw;
    if (errEl) {
      errEl.textContent = 'Settings saved successfully.';
      errEl.hidden = false;
      errEl.classList.add('success');
      setTimeout(() => {
        errEl.hidden = true;
        errEl.classList.remove('success');
      }, 2500);
    }
    setSaveStatus('saved', 'Settings saved successfully');
    showToast('success', 'Settings saved');
  } catch (err) {
    if (errEl) {
      errEl.textContent = 'Failed to save: ' + err.message;
      errEl.hidden = false;
    }
    setSaveStatus('error', 'Failed to save: ' + (err.message || 'unknown error'));
  }
}

function initSettingsDOM() {
  settingsModalEl = $('#settings-modal');
  if (!settingsModalEl) return;

  settingsModalEl.addEventListener('cancel', e => { e.preventDefault(); closeSettings(); });
  // Header close button
  $('#settings-close')?.addEventListener('click', closeSettings);

  // Click outside dialog to close
  settingsModalEl.addEventListener('pointerdown', e => {
    if (e.target === settingsModalEl) closeSettings();
  });

  // Explicit Save button in settings footer
  $('#btn-settings-save')?.addEventListener('click', handleExplicitSave);

  // Keyboard shortcut: Ctrl+S / Cmd+S inside settings modal
  settingsModalEl.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      handleExplicitSave();
    }
  });

  // Switch between UI and JSON mode
  $('#settings-mode-ui')?.addEventListener('click', () => showSettingsUIView());
  $('#settings-mode-json')?.addEventListener('click', () => showSettingsJSONView());

  // Copy path to clipboard
  $('#settings-path')?.addEventListener('click', () => {
    if (settingsData.path) {
      navigator.clipboard.writeText(settingsData.path);
      showToast('success', 'Copied settings path to clipboard', 2000);
    }
  });

  // Search filter
  const searchInput = $('#settings-search');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      settingsFilterQuery = e.target.value;
      renderSettingsList();
    });
    $('#settings-search-clear')?.addEventListener('click', () => {
      searchInput.value = '';
      settingsFilterQuery = '';
      renderSettingsList();
      searchInput.focus();
    });
  }

  // Nav categories
  $('#settings-nav')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-control~=settings-nav-item]');
    if (!btn) return;
    activeSettingsCategory = btn.dataset.cat;
    settingsFilterQuery = '';
    if (searchInput) searchInput.value = '';
    renderSettingsNav();
    renderSettingsList();
  });

  // Settings list events (controls & reset buttons)
  const listEl = $('#settings-list');
  if (listEl) {
    listEl.addEventListener('input', e => {
      const target = e.target;
      const key = target.dataset.key;
      if (!key) return;
      let value = target.value;
      if (target.type === 'number') value = parseFloat(value);
      pendingSettingsChanges[key] = value;
      setSaveStatus('unsaved', 'Unsaved changes');
    });

    listEl.addEventListener('change', e => {
      const target = e.target;
      const key = target.dataset.key;
      if (!key) return;

      let value;
      if (target.type === 'checkbox') {
        value = switchValue(target);
      } else if (target.type === 'number') {
        value = parseFloat(target.value);
        // An out-of-range number is reported on the card and never saved.
        const card = target.closest('[data-ui~=settings-card]');
        card?.querySelector('[data-ui~=settings-card-error]')?.remove();
        const v = target.validity;
        if (isNaN(value) || v.rangeUnderflow || v.rangeOverflow) {
          delete pendingSettingsChanges[key];
          target.setAttribute('aria-invalid', 'true');
          const err = document.createElement('div');
          err.setAttribute('data-ui', 'settings-card-error'); err.className = 'text-destructive';
          err.setAttribute('role', 'alert');
          err.textContent = target.min && target.max
            ? `Enter a number from ${target.min} to ${target.max}.`
            : target.validationMessage || 'Enter a valid number.';
          card?.querySelector('[data-ui~=settings-card-left]')?.append(err);
          return;
        }
      } else {
        value = target.value;
      }
      handleSettingChange(key, value);
    });

    listEl.addEventListener('click', e => {
      const pill = e.target.closest('[data-control~=settings-pill-tag]');
      if (pill) {
        const key = pill.dataset.setKey;
        let value = pill.dataset.setVal;
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        else if (!isNaN(Number(value)) && value.trim() !== '') value = Number(value);
        if (key) handleSettingChange(key, value);
        return;
      }
      const resetBtn = e.target.closest('[data-control~=settings-reset-btn]');
      if (resetBtn) {
        const key = resetBtn.dataset.reset;
        if (key) handleResetSetting(key);
        return;
      }
      const vimHelpBtn = e.target.closest('[data-control~=btn-vim-cheatsheet-trigger]');
      if (vimHelpBtn) {
        showVimHelp();
        return;
      }
    });
  }

  // JSON Raw view buttons
  $('#settings-raw-editor')?.addEventListener('input', () => setSaveStatus('unsaved', 'Unsaved changes'));
  $('#btn-settings-save-raw')?.addEventListener('click', handleSaveRawSettings);
  $('#btn-settings-reset-raw')?.addEventListener('click', () => {
    const rawEditor = $('#settings-raw-editor');
    if (rawEditor) rawEditor.value = settingsData.raw || '{\n}\n';
    const errEl = $('#settings-raw-error');
    if (errEl) errEl.hidden = true;
  });
}

export function initSettings() {
  initSettingsDOM();
  loadSettings().then(() => {
    applyAllSettingsLive();
  });
}
