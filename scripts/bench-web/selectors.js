// The only implementation-specific UI contract. Update this file after a UI rewrite.
// Prefer accessible labels; CSS fallbacks describe surfaces with no ARIA equivalent.
const quote = value => JSON.stringify(value);
export const selectors = {
  all: '*',
  scripts: 'script[src]',
  tree: '#tree',
  treeRows: '#tree .tr',
  treeFile: path => `#tree [title=${quote(`Open ${path}`)}]`,
  expandTree: '[aria-label="Expand all project folders"]',
  collapseTree: '[aria-label="Collapse all folders"]',
  finder: 'input[aria-label="Search commands and files"]',
  finderResults: '#pal-list',
  finderItems: '#pal-list [role="menuitem"]',
  finderItem: name => `#pal-list [role="menuitem"]:has-text(${quote(name)})`,
  viewport: '#viewport',
  codeRows: '#rows .row',
  gutter: '.g',
  code: '.c',
  codeContent: '#rows .c',
  tabs: '#tabs .tab',
  tab: name => `#tabs button:has-text(${quote(name)})`,
  closeTab: '#tabs [aria-label="Close tab"]',
  search: 'input[aria-label="Search in files"]',
  searchResults: '#results [data-ui="rline"]',
  edit: 'textarea[aria-label="File contents"]',
  previewButton: '[aria-label="Preview or source"] button:has-text("Preview")',
  markdown: '#mdview #md',
  markdownHeading: '#mdview h1',
  csv: '#mdview table',
  csvRows: '#mdview tbody tr',
};
export const shortcuts = {
  mod: process.platform === 'darwin' ? 'Meta' : 'Control',
  finder: 'ControlOrMeta+p',
  search: 'ControlOrMeta+Shift+f',
  edit: 'ControlOrMeta+e',
  commands: 'ControlOrMeta+Shift+p',
};
