// web/src/state.js
/**
 * @param {string} s
 * @param {ParentNode} [r=document]
 * @returns {any}
 */
export const $ = (s, r = document) => r.querySelector(s);
/**
 * @param {string} s
 * @param {ParentNode} [r=document]
 * @returns {any[]}
 */
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export { api, apiPost, apiPostJson } from './lib/api.js';

export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
import { isMac, keyLabel, keyParts, withKeys } from './lib/keyboard.js';
export { isMac, keyLabel, withKeys };
export const MOD = isMac ? 'metaKey' : 'ctrlKey';

// Removed when the last legacy module is migrated.
export const keyCaps = combo => keyParts(combo).map(k => '<kbd class="kbd">' + esc(k) + '</kbd>').join('');

// The contents of a shortcut's <kbd class="kbd">: one cap per key in the desktop app, which
// styles nested caps, and the single label everywhere else.
export const shortcutHtml = combo =>
  document.documentElement.hasAttribute('data-shell') ? keyCaps(combo) : esc(keyLabel(combo));

/* Static markup names shortcuts the same way: data-keys fills a label (a <kbd class="kbd">
   gets shortcutHtml), data-caps fills key caps, and {combo} in a title is replaced. */
export function applyKeyLabels(root = document) {
  for (const el of $$('kbd[data-keys]', root)) el.innerHTML = shortcutHtml(el.dataset.keys);
  for (const el of $$(':not(kbd)[data-keys]', root)) el.textContent = keyLabel(el.dataset.keys);
  for (const el of $$('[data-caps]', root)) el.innerHTML = keyCaps(el.dataset.caps);
  for (const el of $$('[title*="{"]', root)) el.title = withKeys(el.title);
}

export const LH = 20, CHUNK = 1000, OVERSCAN = 24;

/**
 * @typedef {Object} LSPState
 * @property {string[]} [servers]
 * @property {string} state - 'off' | 'starting' | 'ready' | 'missing'
 * @property {string} server - server identifier
 * @property {string} [missing]
 */

/**
 * @typedef {Object} DocTab
 * @property {string} path - Workspace relative path
 * @property {string} name - File name
 * @property {string} lang - Language identifier
 * @property {number} total - Total line count
 * @property {number} maxCols - Maximum column width
 * @property {number} size - File size in bytes
 * @property {string[]|null} lines - Windowed line buffer
 * @property {Set<number>} [chunks]
 * @property {Set<number>} [pending]
 * @property {Set<number>} [refining]
 * @property {number} scrollTop
 * @property {number} cur - Active line number
 * @property {number} [col] - Active column number
 * @property {any} [outline]
 * @property {number} [gen]
 * @property {boolean} [markdown]
 * @property {boolean} [isImage]
 * @property {string|null} [diffMode] - 'split' | 'unified' | null
 * @property {boolean} [diffAvailable]
 * @property {boolean} [diffDismissed]
 * @property {boolean} [openedInDiffView]
 * @property {any} [gutter]
 * @property {LSPState} [lsp]
 * @property {boolean} [imageFit]
 * @property {number} [imageScale]
 * @property {number} [imagePanX]
 * @property {number} [imagePanY]
 * @property {string} [imageBg]
 * @property {boolean} [imagePixelated]
 * @property {any} [imageMeta]
 * @property {number} [mdScroll]
 * @property {string} [mdError]
 * @property {string} [mdHtml]
 * @property {boolean} [table]
 * @property {{header: string[], headerLine: number, rows: {line: number, cells: string[]}[], cols: number, truncated: boolean}} [tableData]
 * @property {any} [mdReq]
 * @property {boolean} [prCollapsed]
 * @property {boolean} [youCollapsed]
 * @property {{line: number, col: number}|null} [selAnchor]
 * @property {string} [diffRef] - commit SHA the tab is diffing, '' for the working tree
 * @property {string} [diffText]
 * @property {any} [diffHunks]
 * @property {number} [mdLine]
 * @property {string} [mdAnchor]
 * @property {string} [outlineSource]
 */

/**
 * @typedef {Object} WorkspaceMeta
 * @property {string} root - Absolute root path
 * @property {string} name - Project name
 * @property {string} [version]
 * @property {number} [files]
 * @property {number} [indexMs]
 * @property {boolean} [git]
 * @property {number} [gitChanges]
 * @property {string[]} [gitFiles]
 * @property {boolean} [ready]
 * @property {any} [metrics]
 * @property {any} [pr]
 * @property {{info: {name: string, label: string, tokenKey: string, tokenCategory: string, tokenHint: string}, hasToken: boolean}|null} [forge]
 * @property {any} [agents]
 * @property {string} [agent]
 * @property {string} [agentModel]
 * @property {boolean} [agentPinned]
 */

/**
 * @typedef {Object} AppState
 * @property {WorkspaceMeta|null} meta
 * @property {DocTab[]} tabs
 * @property {number} active
 * @property {Array<{path: string, line: number}>} hist
 * @property {number} histIdx
 * @property {any} find
 * @property {string|null} occ
 * @property {DocTab|null} selAll
 * @property {string} lastWord
 * @property {{word?: string, line?: number, col?: number, path?: string}|null} at
 * @property {{word: string, line: number, col: number}|null} link
 * @property {any} hover
 * @property {any} hoverAnchor
 * @property {LSPState} lsp
 * @property {number} gen
 * @property {number} chW
 * @property {boolean} wrap
 * @property {boolean} lineNumbers
 * @property {boolean} mdPreview
 * @property {boolean} tablePreview
 * @property {any} settings
 * @property {Array<{id: string, path: string, l1: number, l2: number}>} agentTargets
 * @property {number} unpushedCount
 */

/** @type {AppState} */
export const S = {
  meta: null,
  tabs: [],
  active: -1,
  hist: [], histIdx: -1,
  find: null,         // {q, ci, hits:[{line,n}], active}
  occ: null,          // word to highlight everywhere
  selAll: null,       // doc whose whole text is selected (Ctrl+A)
  lastWord: '',
  at: null,           // {word, line, col} of the last click in the code area
  link: null,         // identifier currently underlined under a held modifier
  hover: null,        // identifier the hover card is describing
  hoverAnchor: null,  // where the card was opened, to cheaply detect leaving
  lsp: { servers: [], state: 'off', server: '' },
  gen: 0,
  chW: 7.8,
  wrap: true,        // word wrap (default ON)
  lineNumbers: true, // line numbers gutter (default ON)
  mdPreview: true,   // Markdown tabs open rendered (default ON)
  tablePreview: true, // CSV and TSV tabs open as a table (default ON)
  settings: null,    // loaded from /api/settings
  agentTargets: [],  // [{ id, path, l1, l2 }, ...] ranges of open compose/edit sessions
  unpushedCount: 0,  // commits ahead of the tracking branch; owned by unpushed.js
};

/** @returns {DocTab|null} */
export const doc_ = () => (S.active >= 0 ? S.tabs[S.active] : null);
