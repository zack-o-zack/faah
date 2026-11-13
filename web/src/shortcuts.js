import { layout, render, toggleWordWrap, openFind, cycleTheme, isVimEnabled, showVimHelp, doc_, vp, sizer, MOD, keyCaps } from './app/legacy-bridge.js';

import { ownsNavigationKey } from './controls.js';
// web/src/shortcuts.js
import { $, $$, esc, S } from './state.js';

import { updateStatus } from './status.js';

import { showRightInspector, hideRightInspector } from './app/legacy-bridge.js';
import { hideThreadsSidebar } from './thread.js';
import { isPaletteOpen, openPalette, closePalette } from './app/legacy-bridge.js';

import { previewing, togglePreview, previewKey } from './app/legacy-bridge.js';
import { exitMermaidFullscreen } from './app/legacy-bridge.js';
import { toggleDiff, stepDiffHunk, stepChangedFile } from './app/legacy-bridge.js';
import { openSettings, closeSettings, isSettingsOpen } from './settings.js';

import { handleImageKey } from './app/legacy-bridge.js';
import { submitBatch } from './agent.js';
import { reindexWorkspace } from './panels.js';

import { navigateToTips } from './tips.js';

/* Each entry lists alternative combos, written as for keyLabel in state.js so
   they show as ⌘/⌥/⇧ on a Mac and Ctrl/Alt/Shift elsewhere. Browsers keep
   Ctrl+W and Cmd+W for themselves, so Alt+W is the close shortcut shown. */
export const SHORTCUTS = [
  [['Mod+,'], 'Open settings'],
  [['Mod+K'], 'Quick search / palette'], [['Mod+P'], 'Go to file'],
  [['Mod+Shift+P'], 'Command palette'], [['Mod+Shift+O'], 'Go to symbol'],
  [['Mod+Shift+F'], 'Search in files'], [['Mod+Shift+R'], 'Refresh workspace'], [['Mod+F'], 'Find in file'],
  [['Mod+E'], 'Toggle edit mode'], [['Mod+S'], 'Save file (in edit mode)'],
  [['Mod+G'], 'Go to line'], [['Mod+D'], 'Toggle diff view (git)'], [['Alt+Z'], 'Toggle word wrap'],
  [['[c', ']c'], 'Previous / next diff hunk'], [['[f', ']f'], 'Previous / next changed file'],
  [['Alt+M'], 'Toggle Markdown / table preview'],
  [['Shift+F1'], 'Show symbol documentation'],
  [['Enter', 'Shift+Enter'], 'Next / previous match'],
  [['F12', 'Mod+Click'], 'Go to definition'], [['Shift+F12'], 'Find all references'],
  [['Alt+Shift+H'], 'Call trail (callers / callees)'],
  [['Mod+J'], 'Toggle right sidebar / inspector'],
  [['Alt+Left', 'Alt+Right'], 'Navigate back / forward'], [['Mod+B'], 'Toggle sidebar'],
  [['Alt+W'], 'Close tab'], [['Alt+Shift+T'], 'Reopen closed tab'], [['Ctrl+Tab'], 'Next tab'],
  [['Alt+1…9'], 'Select tab'], [['Double click'], 'Highlight all occurrences'],
  [['Mod+A'], 'Select whole file'],
  [['Mod+C'], 'Copy selection (source / formatted text)'],
  [['Alt+C', 'Alt+A'], 'Copy selection ref / with context'], [['Alt+U'], 'Find usages of selection'],
  [['Alt+E'], 'Edit selection inline'],
  [['Alt+T'], 'Start a thread on the selection'],
  [['Alt+X'], 'Explain the selection'],
  [['Right click'], 'Selection actions at the pointer'],
  [['Mod+Home|Mod+Up', 'Mod+End|Mod+Down'], 'Top / bottom of file'],
  [['Home|Mod+Left', 'End|Mod+Right'], 'Start / end of line'],
  [['Left', 'Right'], 'Move caret along the line'],
  [['Esc'], 'Dismiss'],
];

export function showHelp() {
  const h = $('#helpsheet');
  const ver = S.meta?.version ? ` <span data-ui="help-version" class="p-3 font-mono text-primary-text">v${esc(S.meta.version)}</span>` : '';
  h.innerHTML = '<div class="sm:max-w-4xl overflow-auto"><header class="flex-row! items-center gap-2"><h2>Keyboard Shortcuts</h2>' + ver +
    '<div style="margin-left:auto;display:flex;gap:12px;align-items:center;">' +
    '<button id="btn-switch-to-tips" style="font-size:12px;cursor:pointer;" title="View Tips & Tricks" class="btn" data-control="settings-btn-link" data-variant="link" data-size="xs"><span class="icon-[lucide--lightbulb] size-3.5" aria-hidden="true"></span> Tips & Tricks</button>' +
    '<button id="btn-switch-to-vim-help" style="font-size:12px;cursor:pointer;" title="View Vim Keybindings" class="btn" data-control="settings-btn-link" data-variant="link" data-size="xs">View Vim Keybindings</button>' +
    '</div></header><dl data-ui="help-grid" class="grid grid-cols-[auto_1fr_auto_1fr] gap-3 items-center [&_dt]:flex [&_dt]:gap-1 [&_dt]:justify-end [&_dd]:text-muted-foreground">' +
    SHORTCUTS.map(([combos, v]) => {
      const comboList = Array.isArray(combos) ? combos : [combos];
      return '<dt>' + comboList.map(keyCaps).filter(Boolean).join('<span data-ui="key-or" class="text-muted-foreground">/</span>') + '</dt>' +
        '<dd>' + esc(v) + '</dd>';
    }).join('') + '</dl></div>';
  h.showModal();
  h.querySelector('#btn-switch-to-vim-help')?.addEventListener('click', (e) => {
    e.stopPropagation();
    h.close();
    showVimHelp();
  });
  h.querySelector('#btn-switch-to-tips')?.addEventListener('click', (e) => {
    e.stopPropagation();
    h.close();
    navigateToTips();
  });
}

export const inField = el => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');

export function initShortcuts() {
  $('#btn-theme')?.addEventListener('click', cycleTheme);
  $('#btn-settings')?.addEventListener('click', () => openSettings('ui'));
  $('#btn-help')?.addEventListener('click', () => navigateToTips());
  $('#helpsheet').addEventListener('click', () => { $('#helpsheet').close(); });

  // Footer quick action buttons
  $('#footer-actions')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-control~=bar-action]');
    if (!btn) return;
    const act = btn.dataset.action;
    if (act === 'quick-open') openPalette('file');
    else if (act === 'search') { showRightInspector('search'); $('#q')?.select(); }
    else if (act === 'symbols') openPalette('symbol');
    else if (act === 'find') openFind(S.lastWord);
    else if (act === 'goto') openPalette('line');
    else if (act === 'wrap') toggleWordWrap();
    else if (act === 'md-preview') togglePreview();
    else if (act === 'palette') openPalette('command');
    else if (act === 'settings') openSettings('ui');
    else if (act === 'vim-help') showVimHelp();
    else if (act === 'help') showHelp();
  });

  addEventListener('keydown', e => {
    const mod = e[MOD];
    if (ownsNavigationKey(e)) return;
    const nativePopover = document.querySelector('[popover]:popover-open');
    if (nativePopover && e.key === 'Escape') {
      e.preventDefault();
      nativePopover.hidePopover();
      document.querySelector(`[aria-controls="${nativePopover.id}"]`)?.focus();
      return;
    }
    const menuOpen = document.querySelector('[data-popover][aria-hidden="false"]');
    if (menuOpen && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    if (menuOpen && e.key === 'Escape') { e.preventDefault(); return; }

    if (e.key === 'Escape') {
      if (e.defaultPrevented) return;
      if (document.querySelector('dialog[open]')) {
        e.preventDefault();
        const top = [...document.querySelectorAll('dialog[open]')].at(-1);
        top.dispatchEvent(new Event('cancel', { cancelable: true }));
        if (top.open) top.close();
        return;
      }
      if (exitMermaidFullscreen()) return;
      const lb = $('#img-lightbox');
      if (lb && lb.open) { lb.close(); return; }
      if (isSettingsOpen()) { closeSettings(); return; }
      if (isPaletteOpen()) { closePalette(); return; }
      if ($('#helpsheet').open) { $('#helpsheet').close(); return; }
      if (document.querySelector('dialog[open]')) { document.querySelector('dialog[open]').close(); return; }
      if (!document.body.classList.contains('threads-hidden')) { hideThreadsSidebar(); return; }
      if (!document.body.classList.contains('right-hidden')) { hideRightInspector(); return; }
      if (inField(document.activeElement)) /** @type {HTMLElement} */ (document.activeElement).blur();
      return;
    }

    if (mod && (e.key === ',' || e.key === '<')) {
      e.preventDefault();
      openSettings('ui');
      return;
    }

    // Universal Quick Open / Command Palette: Cmd+K / Ctrl+K
    if (mod && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      openPalette(e.shiftKey ? 'command' : 'file');
      return;
    }

    if (mod && (e.key === 'j' || e.key === 'J')) {
      e.preventDefault();
      if (document.body.classList.contains('right-hidden')) showRightInspector();
      else hideRightInspector();
      return;
    }

    if (mod && e.shiftKey && (e.key === 'P' || e.key === 'p')) { e.preventDefault(); openPalette('command'); return; }
    if (mod && e.shiftKey && (e.key === 'O' || e.key === 'o')) { e.preventDefault(); showRightInspector('symbols'); return; }
    if (mod && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); showRightInspector('search'); $('#q')?.select(); return; }
    if (mod && e.shiftKey && (e.key === 'R' || e.key === 'r')) { e.preventDefault(); reindexWorkspace(); return; }
    if (mod && !e.shiftKey && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); openPalette('file'); return; }
    if (mod && (e.key === 'g' || e.key === 'G')) { e.preventDefault(); openPalette('line'); return; }
    if (mod && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); document.body.classList.toggle('side-hidden'); layout(); render(); return; }
    // Diff view of the open file (git only; fails quiet when git is off).
    if (mod && !e.shiftKey && (e.key === 'd' || e.key === 'D')) { if (S.meta?.git) { e.preventDefault(); toggleDiff(); } return; }
    if (e.altKey && !mod && !e.shiftKey && e.code === 'KeyM') {
      e.preventDefault();
      togglePreview();
      return;
    }

    if (mod && e.shiftKey && !e.altKey && e.key === 'Enter') {
      const b = $('#agentbox');
      if (b && !b.hidden) {
        e.preventDefault();
        submitBatch();
        return;
      }
    }

    if (inField(document.activeElement)) return;

    // [c / ]c (prev/next diff hunk) and [f / ]f (prev/next changed file) chords
    if (!mod && !e.altKey && !e.shiftKey) {
      if (e.key === '[' || e.key === ']') {
        S._bracketPrefix = e.key;
        S._bracketTime = performance.now();
        return;
      }
      if (S._bracketPrefix && performance.now() - (S._bracketTime || 0) < 900) {
        const dir = S._bracketPrefix === ']' ? 1 : -1;
        S._bracketPrefix = '';
        if (e.key === 'c') {
          e.preventDefault();
          stepDiffHunk(dir);
          return;
        }
        if (e.key === 'f') {
          e.preventDefault();
          stepChangedFile(dir);
          return;
        }
      } else {
        S._bracketPrefix = '';
      }
    }

    if (e.key === '?') { e.preventDefault(); showHelp(); return; }
    const d = doc_();
    if (!d) return;
    if (d.isImage) { if (handleImageKey(e)) e.preventDefault(); return; }
    if (previewing(d)) { if (previewKey(e)) e.preventDefault(); return; }
  }, { capture: true });

}
