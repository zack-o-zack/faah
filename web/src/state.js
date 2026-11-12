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

export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/**
 * @typedef {Object} LSPState
 * @property {string[]} [servers]
 * @property {string} state - 'off' | 'starting' | 'ready' | 'missing'
 * @property {string} server - server identifier
 * @property {string} [missing]
 */

/** @typedef {import('./editor/documents.js').DocTab} DocTab */

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
  gen: 0,
  settings: null,
  unpushedCount: 0,
};
