import { setPressed } from './controls.js';
// web/src/reviewwalkthrough.js
import { $, $$, esc, api } from './state.js';
import { showToast } from './ui.js';

let walkthroughData = null;
let activeFilter = 'all'; // 'all' | 'fastReturns' | 'edgeCases' | 'coreLogic'
let activeSubTab = 'walkthrough'; // 'walkthrough' | 'stages'
let walkthroughViewedFiles = new Set();
let observer = null;
let isProgrammaticScroll = false;
let scrollTimeout = null;

export function getWalkthroughSubTab() {
  return activeSubTab;
}

export function setWalkthroughSubTab(tab) {
  activeSubTab = tab;
  const btnWalkthrough = $('#btn-review-tab-walkthrough');
  const btnStages = $('#btn-review-tab-stages');
  const viewWalkthrough = $('#review-walkthrough-view');
  const viewStages = $('#review-stages-view');
  const toolbar = $('#review-walkthrough-toolbar');

  if (tab === 'walkthrough') {
    if (btnWalkthrough) {
      setPressed(btnWalkthrough, true);
      if (btnWalkthrough.setAttribute) btnWalkthrough.setAttribute('aria-selected', 'true');
    }
    if (btnStages) {
      setPressed(btnStages, false);
      if (btnStages.setAttribute) btnStages.setAttribute('aria-selected', 'false');
    }
    if (viewWalkthrough) viewWalkthrough.hidden = false;
    if (viewStages) viewStages.hidden = true;
    if (toolbar) toolbar.hidden = false;

    // Load or refresh walkthrough if empty
    if (!walkthroughData) {
      loadReviewWalkthrough();
    }
  } else {
    if (btnWalkthrough) {
      setPressed(btnWalkthrough, false);
      if (btnWalkthrough.setAttribute) btnWalkthrough.setAttribute('aria-selected', 'false');
    }
    if (btnStages) {
      setPressed(btnStages, true);
      if (btnStages.setAttribute) btnStages.setAttribute('aria-selected', 'true');
    }
    if (viewWalkthrough) viewWalkthrough.hidden = true;
    if (viewStages) viewStages.hidden = false;
    if (toolbar) toolbar.hidden = true;
  }
}

export function initReviewWalkthrough() {
  const btnWalkthrough = $('#btn-review-tab-walkthrough');
  const btnStages = $('#btn-review-tab-stages');
  if (btnWalkthrough) btnWalkthrough.onclick = () => setWalkthroughSubTab('walkthrough');
  if (btnStages) btnStages.onclick = () => setWalkthroughSubTab('stages');

  const btnRefresh = $('#btn-refresh-walkthrough');
  if (btnRefresh) {
    btnRefresh.onclick = () => {
      loadReviewWalkthrough(true);
    };
  }

  // Filter chips (All, Returns, Edge Cases, Core)
  const chips = $$('[data-control~=review-chip]');
  chips.forEach(chip => {
    chip.onclick = () => {
      chips.forEach(c => setPressed(c, false));
      setPressed(chip, true);
      activeFilter = chip.dataset.filter || 'all';
      applyWalkthroughFilter();
    };
  });
}

export async function loadReviewWalkthrough(showFeedback = false) {
  const leftContent = $('#review-understanding-content');
  const rightContent = $('#review-diff-content');

  if (showFeedback && showToast) {
    showToast('info', 'Refreshing walkthrough & diff...', 1500);
  }

  if (leftContent && (!walkthroughData || showFeedback)) {
    leftContent.innerHTML = '<div data-ui="review-empty-state" class="empty flex flex-col items-center justify-center text-center h-full p-3 text-muted-foreground"><div data-ui="review-spinner" class="size-6 rounded-full border-2 border-border border-t-primary animate-spin"></div><p>Analyzing code changes & guardrails...</p></div>';
  }
  if (rightContent && (!walkthroughData || showFeedback)) {
    rightContent.innerHTML = '<div data-ui="review-empty-state" class="empty flex flex-col items-center justify-center text-center h-full p-3 text-muted-foreground"><div data-ui="review-spinner" class="size-6 rounded-full border-2 border-border border-t-primary animate-spin"></div><p>Rendering diff view...</p></div>';
  }

  try {
    const data = await api('/api/review/walkthrough');
    walkthroughData = data;
    renderWalkthroughView(data);
    if (showFeedback && showToast) {
      showToast(`Walkthrough updated: ${data.totalFiles || 0} files analyzed.`, 2000);
    }
  } catch (err) {
    // In headless test environments without an active HTTP server, ignore network errors
    if (typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || process.env?.BUN_TEST)) {
      return;
    }
    if (leftContent) {
      leftContent.innerHTML = `<div data-ui="review-empty-state" class="empty flex flex-col items-center justify-center text-center h-full p-3 text-muted-foreground"><p class="text-destructive">Failed to load code understanding: ${esc(err.message || String(err))}</p></div>`;
    }
    if (rightContent) {
      rightContent.innerHTML = `<div data-ui="review-empty-state" class="empty flex flex-col items-center justify-center text-center h-full p-3 text-muted-foreground"><p class="text-destructive">Failed to load diffs.</p></div>`;
    }
  }
}

// A full commit hash says nothing a short one doesn't, at a fifth the width.
const shortRef = ref => /^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 7) : ref;

// +12 −3, leaving out a side with nothing on it.
function lineStats(add, del) {
  return [add ? `<span class="font-semibold text-gi">+${add}</span>` : '', del ? `<span class="font-semibold text-gd">−${del}</span>` : '']
    .filter(Boolean).join(' ') || '<span class="text-muted-foreground">no line changes</span>';
}

function renderWalkthroughView(data) {
  const leftContent = $('#review-understanding-content');
  const rightContent = $('#review-diff-content');
  const filesBadge = $('#review-walkthrough-files-badge');
  const statHeading = $('#review-understanding-stat');

  const files = data.files || [];
  const totalFiles = data.totalFiles || files.length;
  const additions = data.totalAdditions || 0;
  const deletions = data.totalDeletions || 0;

  if (filesBadge) {
    filesBadge.textContent = String(totalFiles);
  }

  let totalReturns = 0;
  let totalEdge = 0;
  let totalCore = 0;

  for (const f of files) {
    const und = f.understanding || {};
    totalReturns += (und.fastReturns || []).length;
    totalEdge += (und.edgeCases || []).length;
    totalCore += (und.coreLogic || []).length;
  }

  const countReturns = $('#wt-count-returns');
  const countEdge = $('#wt-count-edge');
  const countCore = $('#wt-count-core');
  if (countReturns) countReturns.textContent = totalReturns;
  if (countEdge) countEdge.textContent = totalEdge;
  if (countCore) countCore.textContent = totalCore;

  if (statHeading) {
    statHeading.innerHTML = `${totalFiles} files &middot; ${lineStats(additions, deletions)} &middot; <span class="font-mono">${esc(shortRef(data.baseRef || 'HEAD'))} <span class="icon-[lucide--arrow-right] size-3 align-[-2px]" aria-hidden="true"></span> ${esc(shortRef(data.headRef || 'now'))}</span>`;
  }

  if (files.length === 0) {
    if (leftContent) {
      leftContent.innerHTML = `
        <div data-ui="review-empty-state" class="empty flex flex-col items-center justify-center text-center h-full p-3 text-muted-foreground">
          <span class="icon-[lucide--check] size-3.5 shrink-0" aria-hidden="true"></span>
          <h3>Working Tree is Clean</h3>
          <p>No modified files or uncommitted diffs found against ${esc(data.baseRef || 'HEAD')}.</p>
        </div>`;
    }
    if (rightContent) {
      rightContent.innerHTML = `
        <div data-ui="review-empty-state" class="empty flex flex-col items-center justify-center text-center h-full p-3 text-muted-foreground">
          <span class="icon-[lucide--file] size-3.5 shrink-0" aria-hidden="true"></span>
          <h3>No Diffs to Display</h3>
          <p>Make local changes or switch branches to inspect diffs and code understanding.</p>
        </div>`;
    }
    return;
  }

  // Render Left Pane: Understanding Cards
  renderUnderstandingCards(files);

  // Render Right Pane: Multi-file Diff with Sticky Headers
  renderDiffBlocks(files);

  // Set up Scrollytelling Synchronization via IntersectionObserver
  setupScrollSynchronization();
}

// The left pane is a file list. Insights stay out of the way until a filter
// asks for one kind, then show as one line each under their file.
const INSIGHT_KINDS = [
  ['fastReturns', 'icon-[lucide--zap]'],
  ['edgeCases', 'icon-[lucide--triangle-alert]'],
  ['coreLogic', 'icon-[lucide--target]'],
];

function renderUnderstandingCards(files) {
  const leftContent = $('#review-understanding-content');
  if (!leftContent) return;
  leftContent.innerHTML = '';

  files.forEach((file) => {
    const card = document.createElement('article');
    card.setAttribute('data-ui', 'review-file-card');
    card.className = 'shrink-0 rounded-md [&.active-file-card]:bg-accent [&.is-viewed]:opacity-50';
    card.id = `card-file-${sanitizeId(file.path)}`;
    card.dataset.filePath = file.path;
    if (walkthroughViewedFiles.has(file.path)) card.classList.add('is-viewed');

    const slash = file.path.lastIndexOf('/');
    const row = document.createElement('button');
    row.type = 'button';
    row.setAttribute('data-ui', 'review-card-head');
    row.className = 'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-accent/50';
    row.title = file.path;
    row.innerHTML = `<span class="min-w-0 flex-1 truncate font-mono"><span class="text-muted-foreground">${esc(file.path.slice(0, slash + 1))}</span>${esc(file.path.slice(slash + 1))}</span><span class="shrink-0 font-mono">${lineStats(file.additions, file.deletions)}</span>`;
    row.onclick = () => scrollToDiffFile(file.path);
    card.append(row);

    const und = file.understanding || {};
    const list = document.createElement('div');
    list.setAttribute('data-ui', 'review-insights');
    list.className = 'flex flex-col pb-1';
    list.hidden = true;
    for (const [category, icon] of INSIGHT_KINDS) {
      for (const item of und[category] || []) list.append(insightRow(file.path, category, icon, item));
    }
    card.append(list);
    leftContent.append(card);
  });
  applyWalkthroughFilter();
}

function insightRow(filePath, category, icon, item) {
  const el = document.createElement('button');
  el.type = 'button';
  el.setAttribute('data-ui', 'review-insight-item');
  el.className = 'flex w-full min-w-0 items-center gap-2 rounded-md py-0.5 pl-5 pr-2 text-left text-xs text-muted-foreground hover:text-foreground [&.active-insight-item]:text-foreground';
  el.id = `insight-${sanitizeId(filePath)}-${item.line}`;
  el.dataset.category = category;
  el.dataset.filePath = filePath;
  el.dataset.line = item.line;
  el.title = item.text || '';
  el.innerHTML = `<span class="${icon} size-3 shrink-0" aria-hidden="true"></span><span class="shrink-0 font-mono tabular-nums">L${esc(String(item.line))}</span><span class="min-w-0 flex-1 truncate">${esc(item.explanation || '')}</span>`;
  el.onclick = () => scrollToDiffLine(filePath, item.line);
  return el;
}

function renderDiffBlocks(files) {
  const rightContent = $('#review-diff-content');
  if (!rightContent) return;
  rightContent.innerHTML = '';

  files.forEach(file => {
    const block = document.createElement('div');
    block.setAttribute('data-ui', 'review-diff-file-block'); block.className = 'relative mb-3 overflow-clip rounded-md border';
    block.id = `diff-file-${sanitizeId(file.path)}`;
    block.dataset.filePath = file.path;

    // Sticky File Header
    const stickyHeader = document.createElement('div');
    stickyHeader.setAttribute('data-ui', 'review-diff-file-sticky-header'); stickyHeader.className = 'sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b bg-sidebar px-3 py-2 text-xs';

    const left = document.createElement('div');
    left.setAttribute('data-ui', 'review-sticky-head-left'); left.className = 'flex items-center min-w-0 gap-2';

    const fileIcon = document.createElement('span');
    fileIcon.setAttribute('data-ui', 'review-file-icon'); fileIcon.className = 'flex items-center text-muted-foreground';
    fileIcon.innerHTML = '<span class="icon-[lucide--file] size-3.5 shrink-0" aria-hidden="true"></span>';

    const pathSpan = document.createElement('span');
    pathSpan.setAttribute('data-ui', 'review-sticky-head-path'); pathSpan.className = 'min-w-0 truncate font-mono font-semibold';
    pathSpan.textContent = file.path;

    const statsSpan = document.createElement('span');
    statsSpan.setAttribute('data-ui', 'review-sticky-head-stats'); statsSpan.className = 'shrink-0 font-mono';
    statsSpan.innerHTML = lineStats(file.additions, file.deletions);

    left.append(fileIcon, pathSpan, statsSpan);

    const right = document.createElement('div');
    right.setAttribute('data-ui', 'review-sticky-head-right'); right.className = 'flex items-center gap-2';

    // Viewed checkbox
    const viewedLabel = document.createElement('label');
    viewedLabel.setAttribute('data-ui', 'review-viewed-toggle'); viewedLabel.className = 'inline-flex items-center cursor-pointer select-none gap-2 text-muted-foreground';
    const viewedCheckbox = document.createElement('input');
    viewedCheckbox.type = 'checkbox';
    viewedCheckbox.className = 'input';
    viewedCheckbox.checked = walkthroughViewedFiles.has(file.path);
    viewedCheckbox.onchange = () => {
      if (viewedCheckbox.checked) {
        walkthroughViewedFiles.add(file.path);
        block.classList.add('is-viewed');
      } else {
        walkthroughViewedFiles.delete(file.path);
        block.classList.remove('is-viewed');
      }
      updateViewedBadge(file.path);
    };

    const viewedText = document.createElement('span');
    viewedText.textContent = 'Viewed';
    viewedLabel.append(viewedCheckbox, viewedText);

    right.append(viewedLabel);
    stickyHeader.append(left, right);
    block.append(stickyHeader);

    // Hunks Table
    const hunksTable = document.createElement('div');
    hunksTable.className = 'review-diff-table';

    const hunks = file.hunks || [];
    if (hunks.length === 0) {
      const emptyHunks = document.createElement('div');
      emptyHunks.setAttribute('data-ui', 'review-diff-no-hunks'); emptyHunks.className = 'empty text-center p-3 text-muted-foreground';
      emptyHunks.textContent = 'No diff hunks to display.';
      hunksTable.append(emptyHunks);
    } else {
      hunks.forEach((hunk, hIdx) => {
        const hunkHead = document.createElement('div');
        hunkHead.setAttribute('data-ui', 'review-diff-hunk-header'); hunkHead.className = 'select-none bg-muted/40 px-3 py-1 font-mono text-xs text-muted-foreground';
        hunkHead.textContent = `@@ -${hunk.oldStart || 0} +${hunk.newStart || 0} @@ ${hunk.section || ''}`;
        hunksTable.append(hunkHead);

        (hunk.rows || []).forEach(row => {
          const rowEl = document.createElement('div');
          rowEl.className = 'review-diff-row';
          rowEl.classList.add(row.type === 'add' ? 'diff-type-add' : row.type === 'del' ? 'diff-type-del' : 'diff-type-ctx');
          const lineNum = row.newLine || row.oldLine || 0;
          rowEl.id = `diff-line-${sanitizeId(file.path)}-${lineNum}`;
          rowEl.dataset.filePath = file.path;
          rowEl.dataset.line = lineNum;

          const oldCol = document.createElement('span');
          oldCol.className = 'diff-col-num diff-col-old';
          oldCol.textContent = row.oldLine ? String(row.oldLine) : '';

          const newCol = document.createElement('span');
          newCol.className = 'diff-col-num diff-col-new';
          newCol.textContent = row.newLine ? String(row.newLine) : '';

          const signCol = document.createElement('span');
          signCol.className = 'diff-col-sign';
          signCol.textContent = row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' ';

          const codeCol = document.createElement('span');
          codeCol.className = 'diff-col-code';
          codeCol.textContent = row.text || '';

          rowEl.append(oldCol, newCol, signCol, codeCol);
          hunksTable.append(rowEl);
        });
      });
    }

    block.append(hunksTable);
    rightContent.append(block);
  });
}

function updateViewedBadge(filePath) {
  const card = $(`#card-file-${sanitizeId(filePath)}`);
  if (!card) return;
  if (walkthroughViewedFiles.has(filePath)) {
    card.classList.add('is-viewed');
  } else {
    card.classList.remove('is-viewed');
  }
}

function applyWalkthroughFilter() {
  for (const card of $$('[data-ui~=review-file-card]')) {
    let shown = 0;
    for (const it of card.querySelectorAll('[data-ui~=review-insight-item]')) {
      it.hidden = activeFilter === 'all' || it.dataset.category !== activeFilter;
      if (!it.hidden) shown++;
    }
    const list = card.querySelector('[data-ui~=review-insights]');
    if (list) list.hidden = shown === 0;
    // A filter narrows the list to the files that have that kind.
    card.hidden = activeFilter !== 'all' && shown === 0;
  }
}

export function scrollToDiffFile(filePath) {
  const target = $(`#diff-file-${sanitizeId(filePath)}`);
  const pane = $('#review-diff-pane');
  if (target && pane) {
    markProgrammaticScroll();
    const paneRect = pane.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const targetScrollTop = pane.scrollTop + (targetRect.top - paneRect.top);
    pane.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
    highlightActiveFileCard(filePath, true);
  }
}

export function scrollToDiffLine(filePath, line) {
  const pane = $('#review-diff-pane');
  if (!pane) return;

  let target = $(`#diff-line-${sanitizeId(filePath)}-${line}`);
  if (!target) {
    try {
      target = pane.querySelector(`[data-file-path="${filePath}"][data-line="${line}"]`);
    } catch (e) {
      // Ignore querySelector syntax errors on paths
    }
  }
  if (!target) {
    scrollToDiffFile(filePath);
    return;
  }

  markProgrammaticScroll();
  const paneRect = pane.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const targetScrollTop = pane.scrollTop + (targetRect.top - paneRect.top) - (pane.clientHeight / 3);
  pane.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });

  target.classList.add('diff-row-flash');
  setTimeout(() => {
    target.classList.remove('diff-row-flash');
  }, 1800);

  highlightActiveInsight(filePath, line);
  highlightActiveFileCard(filePath, true);
}

function markProgrammaticScroll() {
  isProgrammaticScroll = true;
  if (scrollTimeout) clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    isProgrammaticScroll = false;
  }, 800);
}

function highlightActiveFileCard(filePath, shouldScrollLeft = false) {
  const cards = $$('[data-ui~=review-file-card]');
  cards.forEach(c => c.classList.remove('active-file-card'));
  const activeCard = $(`#card-file-${sanitizeId(filePath)}`);
  if (activeCard) {
    activeCard.classList.add('active-file-card');
    if (shouldScrollLeft) {
      const listPane = $('#review-understanding-content');
      if (listPane) {
        const paneRect = listPane.getBoundingClientRect();
        const cardRect = activeCard.getBoundingClientRect();
        if (cardRect.top < paneRect.top || cardRect.bottom > paneRect.bottom) {
          const targetScroll = listPane.scrollTop + (cardRect.top - paneRect.top) - 20;
          listPane.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
        }
      }
    }
  }
}

function highlightActiveInsight(filePath, line) {
  const items = $$('[data-ui~=review-insight-item]');
  items.forEach(it => it.classList.remove('active-insight-item'));
  const targetInsight = $(`#insight-${sanitizeId(filePath)}-${line}`);
  if (targetInsight) {
    targetInsight.classList.add('active-insight-item');
    const listPane = $('#review-understanding-content');
    if (listPane) {
      const paneRect = listPane.getBoundingClientRect();
      const itemRect = targetInsight.getBoundingClientRect();
      if (itemRect.top < paneRect.top || itemRect.bottom > paneRect.bottom) {
        const targetScroll = listPane.scrollTop + (itemRect.top - paneRect.top) - 40;
        listPane.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
      }
    }
  }
}

function setupScrollSynchronization() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }

  const diffPane = $('#review-diff-pane');
  if (!diffPane) return;

  const fileBlocks = $$('[data-ui~=review-diff-file-block]');
  if (fileBlocks.length === 0) return;

  // Primary: Scroll event with requestAnimationFrame for smooth, guaranteed active file sync
  let scrollTicking = false;
  diffPane.onscroll = () => {
    if (isProgrammaticScroll) return;
    if (!scrollTicking) {
      requestAnimationFrame(() => {
        syncActiveFileOnScroll();
        scrollTicking = false;
      });
      scrollTicking = true;
    }
  };
}

function syncActiveFileOnScroll() {
  const diffPane = $('#review-diff-pane');
  if (!diffPane) return;
  const blocks = $$('[data-ui~=review-diff-file-block]');
  if (blocks.length === 0) return;

  const paneRect = diffPane.getBoundingClientRect();
  const anchorY = paneRect.top + 70; // 70px below top (just below sticky header)

  let activeBlock = blocks[0];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const r = b.getBoundingClientRect();
    if (r.top <= anchorY && r.bottom > anchorY) {
      activeBlock = b;
      break;
    } else if (r.top > anchorY) {
      break;
    }
    activeBlock = b;
  }

  if (activeBlock?.dataset.filePath) {
    highlightActiveFileCard(activeBlock.dataset.filePath, false);
  }
}

function sanitizeId(str) {
  return String(str || '').replace(/[^a-zA-Z0-9_-]/g, '-');
}
