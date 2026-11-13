import { layout, render, loadSettings, openFile, switchTab, configureLegacyServices, api, applyKeyLabels, initGitStream, triggerRefresh } from './app/legacy-bridge.js';
import { emit, on } from './bus.js';
import { newThread, deleteCurrentThread, showThreadsSidebar } from './app/legacy-bridge.js';


import { selectAgent, loadPickerModels } from './app/legacy-bridge.js';

import { copyToClipboard, copyRichToClipboard, initErrorCopy } from './ui.js';

import { showHelp, initShortcuts } from './shortcuts.js';

import { $, S } from './state.js';
import { revealFile, refreshTree, collapseAllDirs, expandDirtyDirs, inGitMode, setAutoRevealSuppressed, setSidebarMode, hasGitView } from './app/legacy-bridge.js';

import { applyAgentMeta, loadAgentAsync } from './app/legacy-bridge.js';
import { initThreads, setReviewMode, initializePR } from './app/legacy-bridge.js';

import { syncGitPanelMeta } from './app/legacy-bridge.js';

import { refreshUnpushed } from './app/legacy-bridge.js';

// web/src/main.js

export function initLegacy() {
configureLegacyServices({
 emit, on, newThread, deleteCurrentThread, showThreadsSidebar, selectAgent, loadPickerModels,
 copyToClipboard, copyRichToClipboard, showHelp,
});

// Initialize all subsystems


initShortcuts();




initErrorCopy();

// Bootstrap application lifecycle
(async function boot() {
  applyKeyLabels();
  void loadSettings();

  S.meta = await api('/api/meta');
  initThreads();

  syncGitPanelMeta();
  applyAgentMeta();
  initializePR();
  document.title = S.meta.name + ' - faah';
  $('#root-name').textContent = S.meta.name;
  $('#root-name').title = S.meta.root;
  if (S.meta.workbench) {
    // Opened from the workbench (workbench.go): link back to it.
    const back = document.createElement('a');
    back.className = 'btn';
    back.dataset.control = 'icon-action wb-back';
    back.dataset.variant = 'ghost';
    back.dataset.size = 'icon-xs';
    back.href = S.meta.workbench;
    back.title = 'Back to the faah workbench';
    back.setAttribute('aria-label', 'Back to the faah workbench');
    back.innerHTML = '<span class="icon-[lucide--layout-grid] size-3.5" aria-hidden="true"></span>';
    $('#root-name').before(back);
  }
  if (S.meta.version) {
    const emptyVerEl = $('#empty-ver');
    if (emptyVerEl) emptyVerEl.textContent = 'v' + S.meta.version;
  }
  setAutoRevealSuppressed(true);
  await refreshTree();
  initGitStream();

  // Split into helpers so the readiness poll below can redo this once the
  // background indexer (main.go's `go ix.Build()`) finishes: gitChanges/
  // gitFiles are zero until then, so a session that loads before indexing
  // completes (common right after `faah <pr-url>`) would otherwise never
  // auto-select a diff tab -- until the next manual reload.
  const applyGitSidebarState = async () => {
    // The unpushed list decides this too: a clean tree with local commits
    // still belongs in Git view, which is the only place they are listed.
    await refreshUnpushed();
    const showGit = hasGitView();
    await setSidebarMode(showGit ? 'git' : 'files', { expandDirty: showGit });
    return !!(S.meta?.git && ((S.meta.gitChanges > 0) || S.meta?.pr));
  };
  const selectChangedFileTab = async () => {
    if (S.tabs[S.active]?.diffAvailable) return;
    const changedTabIdx = S.tabs.findIndex(t => t.diffAvailable);
    if (changedTabIdx >= 0) {
      switchTab(changedTabIdx);
    } else if (S.meta.gitFiles && S.meta.gitFiles.length > 0) {
      await openFile(S.meta.gitFiles[0]);
    }
  };

  let hasGitChanges = await applyGitSidebarState();

  const params = new URLSearchParams(window.location.search);
  const initialPath = params.get('path');
  const initialLine = parseInt(params.get('line'), 10) || undefined;
  if (initialPath) {
    await openFile(initialPath, { line: initialLine });
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete('path');
      u.searchParams.delete('line');
      const cleanSearch = u.searchParams.toString();
      const cleanUrl = u.pathname + (cleanSearch ? '?' + cleanSearch : '') + u.hash;
      window.history.replaceState({}, '', cleanUrl);
    } catch {}
  } else {
    if (hasGitChanges) await selectChangedFileTab();
  }

  if (inGitMode()) {
    await expandDirtyDirs();
    const activeDoc = S.tabs[S.active];
    if (activeDoc?.path) await revealFile(activeDoc.path);
  } else {
    collapseAllDirs();
  }
  setAutoRevealSuppressed(false);
  // A PR session opens on the pull request itself.
  if (S.meta?.pr) setReviewMode('review');


  // If the background indexer was still running when the UI loaded, poll briefly
  // until complete to update the total file count and index time in the status bar.
  if (S.meta && !S.meta.ready) {
    const timer = setInterval(async () => {
      try {
        const m = await api('/api/meta');
        if (m.ready) {
          clearInterval(timer);
          S.meta = m;

          syncGitPanelMeta();
          setAutoRevealSuppressed(true);
          await refreshTree();
          await triggerRefresh();
          if (!initialPath) {
            hasGitChanges = await applyGitSidebarState();
            if (hasGitChanges) await selectChangedFileTab();
            if (inGitMode()) {
              await expandDirtyDirs();
              const activeDoc = S.tabs[S.active];
              if (activeDoc?.path) await revealFile(activeDoc.path);
            } else {
              collapseAllDirs();
            }
          }
          setAutoRevealSuppressed(false);
        }
      } catch {
        clearInterval(timer);
      }
    }, 150);
  }

  // Load harnesses and models asynchronously after the browser is loaded.
  loadAgentAsync();

})();

}
