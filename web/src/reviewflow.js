import { openFile, layout, api, apiPostJson, keyLabel, showToast, onStream, setStreamTopic, watchThread } from './app/legacy-bridge.js';

import { setMenuHidden } from './overlays.js';
import { on } from './bus.js';
// web/src/reviewflow.js
import { $, $$, S, esc } from './state.js';

import { thrMd } from './thread.js';

import { initReviewWalkthrough, loadReviewWalkthrough, getWalkthroughSubTab, setWalkthroughSubTab } from './reviewwalkthrough.js';

let currentMode = 'code'; // 'code' | 'review'
let currentLayout = (typeof localStorage !== 'undefined' && localStorage.getItem('faah-review-layout')) || 'vertical';
let reviewConfig = {
  name: 'Review pipeline',
  stages: [
    {
      id: 'summary',
      title: 'What this PR does',
      question: 'What does this PR do and what problem does it solve?',
      prompt: 'Analyze this pull request\'s diff and description. Provide a concise explanation of what this PR accomplishes, what problem it solves, and list the key components and files changed. Cite file paths and line ranges where relevant.',
      passPreviousContext: false
    },
    {
      id: 'performance',
      title: 'Performance Impact',
      question: 'Are there any performance bottlenecks, lock contentions, or leaks?',
      prompt: 'Review the changes for performance implications: computational complexity, memory allocations, potential blocking I/O operations, database/network bottlenecks, or mutex/lock contention. Identify any hotspots with exact file:line references.',
      passPreviousContext: true
    },
    {
      id: 'architecture',
      title: 'Architecture & Quality',
      question: 'How does this impact design modularity, edge cases, and maintainability?',
      prompt: 'Evaluate the software architecture, design modularity, readability, maintainability, and error handling. Note any anti-patterns, edge cases that might fail silently, or breaking API changes.',
      passPreviousContext: true
    },
    {
      id: 'testing',
      title: 'Testing & Edge Cases',
      question: 'Are there missing tests or verification steps?',
      prompt: 'Check test coverage for the changes. Are new code paths, error states, and edge conditions tested? Suggest specific tests or verification checks if coverage is incomplete.',
      passPreviousContext: true
    }
  ]
};
let currentRun = null;
let activeStageIdx = 0;
let stageThread = null; // { id, t, release }: the stage thread shown, and its live feed
let lastJumpContext = null; // { path, line, stageTitle }

// Status as a dot: green done, yellow working, grey not started yet.
const STATUS = {
  pending: { dot: 'bg-muted-foreground/40', label: 'Not started' },
  running: { dot: 'bg-warn animate-pulse', label: 'Working' },
  completed: { dot: 'bg-gi', label: 'Done' },
  failed: { dot: 'bg-destructive', label: 'Failed' },
  stopped: { dot: 'bg-muted-foreground/40 ring-1 ring-muted-foreground', label: 'Stopped' },
};
const statusOf = s => STATUS[s] || STATUS.pending;
const dotHtml = (s, extra = '') => `<span class="size-2 shrink-0 rounded-full ${statusOf(s).dot} ${extra}" aria-hidden="true"></span>`;

// Safe property getters supporting both lower and upper case keys from Go JSON
function getDef(st) {
  return st?.def || st?.Def || st || {};
}
function getTitle(d) {
  return d?.title || d?.Title || '';
}
function getQuestion(d) {
  return d?.question || d?.Question || '';
}
function getPrompt(d) {
  return d?.prompt || d?.Prompt || '';
}
function getStatus(st) {
  return (st?.status || st?.Status || 'pending').toLowerCase();
}
function getThreadId(st) {
  return st?.threadId || st?.ThreadID || '';
}
function getStages(obj) {
  return obj?.stages || obj?.Stages || [];
}

function getWorkflowStages() {
  if (reviewConfig.stages && Array.isArray(reviewConfig.stages) && reviewConfig.stages.length > 0) {
    return reviewConfig.stages;
  }
  const wf = reviewConfig.workflows?.[0] || reviewConfig.Workflows?.[0];
  if (wf) {
    return getStages(wf);
  }
  return [];
}

function getWorkflowName() {
  return reviewConfig.name || reviewConfig.workflows?.[0]?.name || reviewConfig.Workflows?.[0]?.Name || 'Review pipeline';
}

export function getMode() {
  return currentMode;
}

export function getLayout() {
  return currentLayout;
}

export function setLayout(l) {
  currentLayout = l === 'horizontal' ? 'horizontal' : 'vertical';
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('faah-review-layout', currentLayout);
  }

  const reviewView = $('#review-view');
  if (reviewView) {
    reviewView.classList.remove('layout-vertical', 'layout-horizontal');
    reviewView.classList.add(`layout-${currentLayout}`);
  }

  const iconVert = $('#icon-layout-vert');
  const iconHoriz = $('#icon-layout-horiz');
  if (iconVert && iconHoriz) {
    iconVert.hidden = currentLayout === 'horizontal';
    iconHoriz.hidden = currentLayout !== 'horizontal';
  }
}

export function setMode(mode) {
  if (mode === currentMode) return;
  currentMode = mode;

  const reviewView = $('#review-view');
  const editor = $('#editor');
  const returnPill = $('#review-return-pill');

  if (mode === 'review') {
    document.body.classList.add('in-review-mode');
    if (editor) editor.hidden = true;
    if (reviewView) reviewView.hidden = false;
    if (returnPill) returnPill.hidden = true;
    setLayout(currentLayout);
    setWalkthroughSubTab(getWalkthroughSubTab());
    if (getWalkthroughSubTab() === 'walkthrough') {
      loadReviewWalkthrough();
    }
    renderPipeline();
    renderActiveStage();
    loadWorkflowStatus();
    connectWorkflowStream();
  } else {
    document.body.classList.remove('in-review-mode');
    if (reviewView) reviewView.hidden = true;
    if (editor) editor.hidden = false;
    disconnectWorkflowStream();
    layout();
    if (lastJumpContext && returnPill) {
      returnPill.hidden = false;
      const lbl = $('#review-return-label');
      if (lbl) lbl.textContent = `Jumped from: ${lastJumpContext.stageTitle || 'Review'}`;
    }
  }
}

export function disconnectWorkflowStream() {
  setStreamTopic('review', false);
  releaseStageThread();
}

function followStageThread(st) {
  st.release = watchThread(st.id);
  st.live = true;
}

function releaseStageThread() {
  stageThread?.release();
  stageThread = null;
}

export function initReviewFlow() {
  document.addEventListener('click', e => { if (!e.target.closest?.('#review-stage-menu, [data-control~=review-stage-menu-btn]')) closeStageMenu(); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || $('#review-stage-menu')?.hidden !== false) return;
    const anchor = $('#review-stage-menu')._anchor;
    closeStageMenu();
    anchor?.focus();
  });
  initReviewWalkthrough();
  wireModeControls();
  wireLayoutControls();
  wirePipelineActions();
  wireComposeActions();
  wireHyperlinks();
  wireInlineStageEditor();
  wireAddStageModal();
  wireWorkflowNameEditor();
  wireStreams();
}

function wireModeControls() {
  const open = $('#btn-pr-toggle');
  if (open) open.onclick = () => setMode('review');
  const close = $('#btn-pr-close');
  if (close) close.onclick = () => setMode('code');
  // Opening a file leaves the overview; closing a tab behind it does not.
  on('tab:activated', e => { if (e && 'prevDoc' in e) setMode('code'); });

  const returnBtn = $('#btn-return-to-review');
  if (returnBtn) {
    returnBtn.onclick = () => setMode('review');
  }
  const dismissBtn = $('#btn-dismiss-review-return');
  if (dismissBtn) {
    dismissBtn.onclick = () => {
      lastJumpContext = null;
      const pill = $('#review-return-pill');
      if (pill) pill.hidden = true;
    };
  }

  // Mod+Shift+V opens or leaves the overview.
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
      e.preventDefault();
      setMode(currentMode === 'review' ? 'code' : 'review');
    }
  });
}

function wireLayoutControls() {
  const btnToggle = $('#btn-toggle-review-layout');
  if (btnToggle) {
    btnToggle.onclick = () => {
      setLayout(currentLayout === 'vertical' ? 'horizontal' : 'vertical');
    };
  }
  setLayout(currentLayout);
}

function wireWorkflowNameEditor() {
  const nameEl = $('#review-workflow-name');
  if (!nameEl) return;
  nameEl.title = 'Click to edit workflow name';
  nameEl.onclick = () => {
    const currentName = getWorkflowName();
    const newName = prompt('Enter workflow name:', currentName);
    if (newName && newName.trim() && newName.trim() !== currentName) {
      reviewConfig.name = newName.trim();
      if (reviewConfig.workflows?.[0]) {
        reviewConfig.workflows[0].name = reviewConfig.name;
      }
      nameEl.textContent = reviewConfig.name;
      saveConfigToServer();
    }
  };
}

async function loadWorkflowStatus() {
  try {
    const data = await api('/api/review-workflow/status');
    if (data.config) {
      reviewConfig = data.config;
      // Ensure reviewConfig.stages is always populated
      if (!reviewConfig.stages || !Array.isArray(reviewConfig.stages) || reviewConfig.stages.length === 0) {
        reviewConfig.stages = getWorkflowStages();
      }
    }
    if (data.run) {
      currentRun = data.run;
      const runIdx = typeof currentRun.activeStage === 'number' ? currentRun.activeStage : currentRun.ActiveStage;
      if (typeof runIdx === 'number') {
        activeStageIdx = runIdx;
      }
    }
    renderPipeline();
    renderActiveStage();
    updateBackgroundStatusDot();
  } catch (err) {
    console.error('Failed to load review workflow status:', err);
  }
}

function connectWorkflowStream() {
  if (currentMode !== 'review') return;
  setStreamTopic('review', true);
}

// Workflow and stage-thread events arrive on the tab's shared event stream
// (stream.js); these handlers stay registered and the topics turn them on.
function wireStreams() {
  onStream('review:snapshot', (run) => {
    if (!run) return;
    currentRun = run;
    renderPipeline();
    renderActiveStage();
    updateBackgroundStatusDot();
  });

  const handleUpdate = (data) => {
    if (!data) return;
    if (data.stages || data.Stages) {
      currentRun = data;
    } else if (data.stage && currentRun) {
      const runStages = currentRun.stages || currentRun.Stages;
      if (runStages && runStages[data.stageIndex]) {
        runStages[data.stageIndex] = data.stage;
      }
      currentRun.activeStage = data.stageIndex;
    }
    renderPipeline();
    renderActiveStage();
    updateBackgroundStatusDot();
  };
  for (const name of ['run_started', 'stage_started', 'stage_updated', 'stage_completed', 'stage_failed', 'run_completed', 'run_stopped']) {
    onStream('review:' + name, handleUpdate);
  }

  // The stage transcript is patched from the events themselves: refetching
  // the whole thread per delta sent a request per streamed token.
  let paintRAF = 0;
  const paint = () => {
    if (paintRAF) return;
    paintRAF = requestAnimationFrame(() => {
      paintRAF = 0;
      if (stageThread?.t) renderThreadTranscript(stageThread.t);
    });
  };
  const turnOf = (d) => {
    const turns = stageThread?.t?.turns || stageThread?.t?.Turns || [];
    return turns.find(x => (x.id || x.ID) === d.turn);
  };
  onStream('thread:thread', ({ id, data }) => {
    if (stageThread?.id !== id) return;
    stageThread.t = data;
    paint();
  });
  onStream('thread:delta', ({ id, data: d }) => {
    if (stageThread?.id !== id) return;
    const turn = turnOf(d);
    if (!turn) return;
    turn.reply = (turn.reply || '') + d.text;
    paint();
  });
  onStream('thread:tool', ({ id, data: d }) => {
    if (stageThread?.id !== id) return;
    const turn = turnOf(d);
    if (!turn) return;
    (turn.tools = turn.tools || []).push(d.text);
    paint();
  });
}

function updateBackgroundStatusDot() {
  const status = currentRun?.status || currentRun?.Status;
  for (const dot of $$('[data-ui~=review-status-dot]')) dot.hidden = status !== 'running';
}

function renderPipeline() {
  const container = $('#review-stages-container');
  if (!container) return;

  const stagesList = getWorkflowStages();
  if (stagesList.length === 0) {
    container.innerHTML = '<li class="px-2 py-3 text-xs text-muted-foreground">No stages yet. Add one with +.</li>';
    return;
  }

  const nameEl = $('#review-workflow-name');
  if (nameEl) nameEl.textContent = getWorkflowName();

  const runStages = currentRun ? getStages(currentRun) : null;
  const items = (runStages && runStages.length === stagesList.length)
    ? runStages
    : stagesList.map(s => ({ def: s, status: 'pending' }));

  container.innerHTML = '';
  items.forEach((st, idx) => {
    const def = getDef(st);
    const title = getTitle(def) || `Stage ${idx + 1}`;
    const question = getQuestion(def) || '';
    const status = getStatus(st);
    const isActive = idx === activeStageIdx;

    const last = idx === items.length - 1;
    const card = document.createElement('li');
    card.setAttribute('data-ui', 'review-stage-card');
    card.className = `group relative flex rounded-md [&.active]:bg-accent ${status} ${isActive ? 'active' : ''}`;
    card.dataset.index = String(idx);

    // A dot per stage on a thin rail, like steps in a sequence.
    card.innerHTML = `
      <button type="button" data-control="review-stage-select" aria-pressed="${isActive}" aria-label="Stage ${idx + 1}: ${esc(title)}, ${statusOf(status).label}" class="flex w-full min-w-0 items-start gap-2.5 rounded-md px-2 py-2 pr-8 text-left hover:bg-accent/50 focus-visible:outline focus-visible:outline-ring">
        <span class="relative flex w-2 shrink-0 justify-center self-stretch pt-1.5">${dotHtml(status, 'relative z-10')}${last ? '' : '<span class="absolute top-4 -bottom-3 w-px bg-border" aria-hidden="true"></span>'}</span>
        <span data-ui="review-stage-card-body" class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span data-ui="review-stage-card-title" class="text-sm font-medium wrap-anywhere">${esc(title)}</span>
          <span data-ui="review-stage-card-desc" class="line-clamp-2 text-xs text-muted-foreground wrap-anywhere">${esc(question)}</span>
        </span>
      </button>
      <button type="button" title="Stage actions" aria-label="Actions for ${esc(title)}" aria-haspopup="menu" aria-expanded="false" class="btn absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 aria-expanded:opacity-100" data-control="review-stage-menu-btn" data-variant="ghost" data-size="icon-xs"><span class="icon-[lucide--ellipsis] size-3.5 shrink-0" aria-hidden="true"></span></button>
    `;

    card.onclick = (e) => {
      const menuBtn = e.target.closest('[data-control~=review-stage-menu-btn]');
      if (menuBtn) {
        e.stopPropagation();
        openStageMenu(idx, menuBtn);
        return;
      }
      activeStageIdx = idx;
      renderPipeline();
      renderActiveStage();
      container.querySelector(`[data-index="${idx}"] [data-control~=review-stage-select]`)?.focus();
    };
    card.oncontextmenu = (e) => {
      e.preventDefault();
      openStageMenu(idx, card.querySelector('[data-control~=review-stage-menu-btn]'), e);
    };

    container.appendChild(card);
  });

  renderStagesBadge(items);

  // Update Run / Stop buttons
  const isRunning = (currentRun?.status || currentRun?.Status) === 'running';
  const btnRun = $('#btn-run-review-flow');
  const btnStop = $('#btn-stop-review-flow');
  if (btnRun) btnRun.hidden = isRunning;
  if (btnStop) btnStop.hidden = !isRunning;
}

// The tab's badge carries the pipeline's progress, so it can be read from
// the Diff tab without switching: a dot per stage, or done/total when long.
function renderStagesBadge(items) {
  const badge = $('#review-stages-count-badge');
  if (!badge) return;
  const statuses = items.map(getStatus);
  const done = statuses.filter(s => s === 'completed').length;
  badge.innerHTML = items.length <= 8
    ? statuses.map(s => dotHtml(s, 'size-1.5!')).join('')
    : dotHtml(statuses.find(s => s === 'running' || s === 'failed') || (done === items.length ? 'completed' : 'pending')) + `${done}/${items.length}`;
  const working = items.findIndex((st, i) => statuses[i] === 'running');
  const failed = statuses.includes('failed');
  badge.title = `${done} of ${items.length} done` +
    (working >= 0 ? ` · working on ${getTitle(getDef(items[working])) || 'stage ' + (working + 1)}` : '') +
    (failed ? ' · a stage failed' : '');
  badge.setAttribute('aria-label', badge.title);
}

// One menu for every stage, opened from its ⋯ button or a right-click.
// Reordering and removing wait while the pipeline runs, since the run's
// stages are matched to the list by position.
const MENU_ITEM = 'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50';

function openStageMenu(idx, anchor, pointer) {
  const menu = $('#review-stage-menu');
  if (!menu) return;
  const stages = getWorkflowStages();
  const running = (currentRun?.status || currentRun?.Status) === 'running';
  const item = (act, icon, label, { disabled = false, cls = '' } = {}) =>
    `<button type="button" data-act="${act}" class="${MENU_ITEM} ${cls}"${disabled ? ' disabled' : ''}><span class="${icon} size-3.5 shrink-0" aria-hidden="true"></span>${label}</button>`;
  menu.innerHTML =
    item('run', 'icon-[lucide--sparkle] text-special', 'Run this stage', { disabled: running }) +
    item('edit', 'icon-[lucide--square-pen]', 'Edit') +
    item('up', 'icon-[lucide--arrow-up]', 'Move up', { disabled: running || idx === 0 }) +
    item('down', 'icon-[lucide--arrow-down]', 'Move down', { disabled: running || idx === stages.length - 1 }) +
    '<hr role="separator" class="my-1 border-border">' +
    item('remove', 'icon-[lucide--trash-2]', 'Remove', { disabled: running || stages.length <= 1, cls: 'text-destructive' });
  for (const b of menu.querySelectorAll('button')) b.onclick = () => { closeStageMenu(); stageAction(b.dataset.act, idx); };
  closeStageMenu();
  setMenuHidden(menu, false);
  menu._anchor = anchor;
  anchor?.setAttribute('aria-expanded', 'true');
  const r = pointer ? { left: pointer.clientX, right: pointer.clientX, top: pointer.clientY, bottom: pointer.clientY } : anchor.getBoundingClientRect();
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(innerWidth - w - 8, pointer ? r.left : r.right - w)) + 'px';
  menu.style.top = (innerHeight - r.bottom < h + 12 ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px';
  menu.style.right = menu.style.bottom = 'auto';
  menu.querySelector('button:not(:disabled)')?.focus();
}

function closeStageMenu() {
  const menu = $('#review-stage-menu');
  if (!menu || menu.hidden) return;
  setMenuHidden(menu, true);
  menu._anchor?.setAttribute('aria-expanded', 'false');
  menu._anchor = null;
}

async function stageAction(act, idx) {
  if (act === 'run') return runWorkflow(idx);
  if (act === 'edit') {
    activeStageIdx = idx;
    renderPipeline();
    renderActiveStage();
    return openInlineStageEditor();
  }
  if (act === 'remove') return removeStage(idx);
  const to = act === 'up' ? idx - 1 : idx + 1;
  const stages = getWorkflowStages();
  if (to < 0 || to >= stages.length) return;
  [stages[idx], stages[to]] = [stages[to], stages[idx]];
  reviewConfig.stages = stages;
  if (reviewConfig.workflows?.[0]) reviewConfig.workflows[0].stages = stages;
  if (activeStageIdx === idx) activeStageIdx = to;
  else if (activeStageIdx === to) activeStageIdx = idx;
  try {
    await saveConfigToServer();
  } catch (err) {
    showToast('error', err.message);
  }
  renderPipeline();
  renderActiveStage();
}

async function removeStage(idx) {
  const stages = getWorkflowStages();
  if (stages.length <= 1) {
    showToast('error', 'Workflow must have at least one stage');
    return;
  }
  const def = stages[idx];
  const removedTitle = getTitle(def) || `Stage ${idx + 1}`;
  stages.splice(idx, 1);
  reviewConfig.stages = stages;
  if (reviewConfig.workflows?.[0]) {
    reviewConfig.workflows[0].stages = stages;
  }

  if (activeStageIdx >= stages.length) {
    activeStageIdx = Math.max(0, stages.length - 1);
  }
  try {
    await saveConfigToServer();
    showToast('info', `Removed stage: ${removedTitle}`, 2000);
    renderPipeline();
    renderActiveStage();
  } catch (err) {
    showToast('error', err.message);
  }
}

async function saveConfigToServer() {
  const stages = getWorkflowStages();
  const payload = {
    name: getWorkflowName(),
    stages: stages,
    workflows: [
      {
        id: 'standard',
        name: getWorkflowName(),
        stages: stages
      }
    ],
    activeId: 'standard'
  };
  await apiPostJson('/api/review-workflow/config', payload);
}

function renderActiveStage() {
  const stages = getWorkflowStages();
  if (stages.length === 0) return;

  if (activeStageIdx >= stages.length) {
    activeStageIdx = 0;
  }

  const runStages = currentRun ? getStages(currentRun) : null;
  const currentStageState = runStages ? runStages[activeStageIdx] : null;
  const def = currentStageState ? getDef(currentStageState) : stages[activeStageIdx] || {};

  const badge = $('#review-stage-badge');
  const title = $('#review-stage-title');
  const tag = $('#review-stage-status-tag');
  const question = $('#review-question-text');

  const titleText = getTitle(def) || `Stage ${activeStageIdx + 1}`;
  const questionText = getQuestion(def) || getPrompt(def) || '';

  if (badge) badge.textContent = `Stage ${activeStageIdx + 1} of ${stages.length}`;
  if (title) title.textContent = titleText;
  if (question) question.textContent = questionText;

  const status = currentStageState ? getStatus(currentStageState) : 'pending';
  if (tag) tag.innerHTML = dotHtml(status) + esc(statusOf(status).label);

  // Hide inline editor when changing stages
  const inlineEditor = $('#review-stage-inline-editor');
  const questionBanner = $('#review-question-banner');
  if (inlineEditor) inlineEditor.hidden = true;
  if (questionBanner) questionBanner.hidden = !questionText.trim();

  const threadId = currentStageState ? getThreadId(currentStageState) : '';
  const msgsEl = $('#review-thread-msgs');
  if (!msgsEl) return;

  if (!threadId) {
    msgsEl.innerHTML = `
      <div data-ui="review-thread-placeholder" class="empty flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
        <p>Your coding harness hasn't answered this one yet.</p>
        <button id="btn-start-single-stage" class="btn" data-control="bar-action" data-variant="special" data-size="sm"><span class="icon-[lucide--sparkle] size-3.5 shrink-0" aria-hidden="true"></span>Run this stage</button>
      </div>
    `;
    const startSingle = $('#btn-start-single-stage');
    if (startSingle) {
      startSingle.onclick = () => runWorkflow(activeStageIdx);
    }
    return;
  }

  loadAndStreamStageThread(threadId);
}

function openInlineStageEditor() {
  const inlineEditor = $('#review-stage-inline-editor');
  const questionBanner = $('#review-question-banner');
  if (!inlineEditor) return;

  const stages = getWorkflowStages();
  const def = stages[activeStageIdx] || {};

  const titleIn = $('#inline-edit-stage-title');
  const qIn = $('#inline-edit-stage-q');
  const promptIn = $('#inline-edit-stage-prompt');

  if (titleIn) titleIn.value = getTitle(def);
  if (qIn) qIn.value = getQuestion(def);
  if (promptIn) promptIn.value = getPrompt(def);

  inlineEditor.hidden = false;
  if (questionBanner) questionBanner.hidden = true;
  if (qIn) qIn.focus();
}

function wireInlineStageEditor() {
  const btnEditInline = $('#btn-edit-stage-inline');
  const btnQuickEditQ = $('#btn-quick-edit-q');
  const btnSave = $('#btn-save-stage-inline');
  const btnCancel = $('#btn-cancel-stage-inline');

  if (btnEditInline) btnEditInline.onclick = openInlineStageEditor;
  if (btnQuickEditQ) btnQuickEditQ.onclick = openInlineStageEditor;

  if (btnCancel) {
    btnCancel.onclick = () => {
      const inlineEditor = $('#review-stage-inline-editor');
      const questionBanner = $('#review-question-banner');
      if (inlineEditor) inlineEditor.hidden = true;
      if (questionBanner) questionBanner.hidden = !$('#review-question-text')?.textContent?.trim();
    };
  }

  if (btnSave) {
    btnSave.onclick = async () => {
      const stages = getWorkflowStages();
      const def = stages[activeStageIdx];
      if (!def) return;

      const titleIn = $('#inline-edit-stage-title');
      const qIn = $('#inline-edit-stage-q');
      const promptIn = $('#inline-edit-stage-prompt');

      const newTitle = (titleIn?.value || '').trim() || getTitle(def);
      const newQ = (qIn?.value || '').trim();
      const newPrompt = (promptIn?.value || '').trim();

      def.title = newTitle;
      def.Title = newTitle;
      def.question = newQ;
      def.Question = newQ;
      def.prompt = newPrompt;
      def.Prompt = newPrompt;

      try {
        await saveConfigToServer();
        showToast('success', 'Stage updated', 2000);
        const inlineEditor = $('#review-stage-inline-editor');
        const questionBanner = $('#review-question-banner');
        if (inlineEditor) inlineEditor.hidden = true;
        if (questionBanner) questionBanner.hidden = !$('#review-question-text')?.textContent?.trim();
        renderPipeline();
        renderActiveStage();
      } catch (err) {
        showToast('error', err.message);
      }
    };
  }
}

async function loadAndStreamStageThread(threadId) {
  const msgsEl = $('#review-thread-msgs');
  if (!msgsEl) return;

  // Workflow updates re-render the active stage often; the same thread is
  // already followed, so just repaint what we have.
  if (stageThread?.id === threadId && stageThread.t) {
    if (currentMode === 'review' && !stageThread.live) followStageThread(stageThread);
    renderThreadTranscript(stageThread.t);
    return;
  }

  releaseStageThread();
  const cur = stageThread = { id: threadId, t: null, live: false, release: () => {} };
  // Follow the thread only while actively viewing it in review mode.
  if (currentMode === 'review') followStageThread(cur);

  try {
    const t = await api(`/api/threads/get?id=${encodeURIComponent(threadId)}`);
    if (stageThread !== cur) return;
    if (!cur.t) cur.t = t; // a stream snapshot may already have landed
    renderThreadTranscript(cur.t);
  } catch (err) {
    if (stageThread !== cur) return;
    msgsEl.innerHTML = `<div class="review-err">Failed to load stage thread: ${esc(err.message)}</div>`;
  }
}

function renderThreadTranscript(t) {
  const msgsEl = $('#review-thread-msgs');
  if (!msgsEl || !t) return;

  let html = '';
  const turns = t.turns || t.Turns || [];
  turns.forEach((turn, i) => {
    const prompt = turn.prompt || turn.Prompt || '';
    const reply = turn.reply || turn.Reply || '';
    const running = turn.running || turn.Running;
    const model = turn.model || turn.Model || '';
    const error = turn.error || turn.Error;
    const tools = turn.tools || turn.Tools || [];

    // The first turn is the stage's own instructions: there for reference,
    // folded away. Follow-ups are the reviewer's words, shown like a chat.
    html += i === 0
      ? `<details data-ui="thr-msg" class="user group/instr rounded-md border px-3 py-2 text-xs text-muted-foreground [&::details-content]:overflow-hidden">
          <summary class="flex cursor-pointer list-none items-center gap-1.5"><span class="icon-[lucide--chevron-right] size-3 shrink-0 group-open/instr:rotate-90" aria-hidden="true"></span>Instructions sent to the harness</summary>
          <div class="thr-body mt-2">${thrMd(prompt)}</div>
        </details>`
      : `<div data-ui="thr-msg" class="user thr-user ml-8 self-end min-w-0 rounded-lg bg-muted px-3 py-2 text-sm"><div class="thr-body">${thrMd(prompt)}</div></div>`;

    if (reply || running) {
      const steps = tools.length ? `<details class="group/steps text-xs text-muted-foreground [&::details-content]:overflow-hidden"><summary class="flex cursor-pointer list-none items-center gap-1.5"><span class="icon-[lucide--chevron-right] size-3 shrink-0 group-open/steps:rotate-90" aria-hidden="true"></span>${tools.length} step${tools.length === 1 ? '' : 's'}</summary><ul class="mt-1 flex flex-col gap-0.5 pl-4">${tools.map(tl => `<li class="truncate">${esc(tl)}</li>`).join('')}</ul></details>` : '';
      html += `
        <div data-ui="thr-msg" class="assistant flex min-w-0 flex-col gap-2 ${running ? 'running' : ''}">
          <span class="flex items-center gap-1.5 text-xs font-medium text-special"><span class="icon-[lucide--sparkle] size-3 shrink-0" aria-hidden="true"></span>${esc(model || 'Coding harness')}</span>
          ${steps}
          <div class="thr-body text-sm">${reply ? thrMd(reply) : '<span class="inline-flex items-center gap-2 text-muted-foreground"><span class="icon-[lucide--loader-circle] size-3.5 animate-spin" aria-hidden="true"></span>Reading the changes…</span>'}</div>
        </div>
      `;
    }

    if (error) {
      html += `<div data-ui="thr-err" class="alert whitespace-pre-wrap wrap-anywhere p-3 font-mono text-destructive">Error: ${esc(error)}</div>`;
    }
  });

  msgsEl.innerHTML = html;
  msgsEl.scrollTop = msgsEl.scrollHeight;
}

function wirePipelineActions() {
  const btnRun = $('#btn-run-review-flow');
  if (btnRun) btnRun.onclick = () => runWorkflow(0);

  const btnStop = $('#btn-stop-review-flow');
  if (btnStop) btnStop.onclick = stopWorkflow;

  const btnRerun = $('#btn-rerun-stage');
  if (btnRerun) btnRerun.onclick = () => runWorkflow(activeStageIdx);
}

function wireComposeActions() {
  const input = $('#review-compose-input');
  const sendBtn = $('#review-compose-send');

  const send = async () => {
    if (!input) return;
    const msg = input.value.trim();
    if (!msg) return;

    const runStages = currentRun ? getStages(currentRun) : null;
    const currentStageState = runStages ? runStages[activeStageIdx] : null;
    const threadId = currentStageState ? getThreadId(currentStageState) : '';
    if (!threadId) {
      showToast('info', 'Run the stage first before asking follow-up questions.');
      return;
    }

    input.value = '';
    sendBtn.disabled = true;
    try {
      await apiPostJson('/api/threads/send', { id: threadId, message: msg });
    } catch (err) {
      showToast('error', err.message);
    } finally {
      sync();
    }
  };

  if (sendBtn) sendBtn.onclick = send;
  const sync = () => { if (sendBtn) sendBtn.disabled = !input?.value.trim(); };
  if (input) input.oninput = sync;
  if (input) {
    input.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    };
  }
}

async function runWorkflow(stageIndex = 0) {
  try {
    const res = await apiPostJson('/api/review-workflow/run', {
      workflowId: 'standard',
      stageIndex: stageIndex
    });
    if (res.run) {
      currentRun = res.run;
      activeStageIdx = stageIndex;
      if (currentMode === 'review') {
        connectWorkflowStream();
      }
      renderPipeline();
      renderActiveStage();
      updateBackgroundStatusDot();
    }
  } catch (err) {
    showToast('error', 'Failed to start review workflow: ' + err.message);
  }
}

async function stopWorkflow() {
  try {
    const res = await apiPostJson('/api/review-workflow/stop', {});
    if (res.run) {
      currentRun = res.run;
      renderPipeline();
      renderActiveStage();
      updateBackgroundStatusDot();
    }
  } catch (err) {
    showToast('error', err.message);
  }
}

function wireHyperlinks() {
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a.thr-link');
    if (!link || !link.dataset.path) return;

    e.preventDefault();
    const path = link.dataset.path;
    const line = parseInt(link.dataset.line, 10) || 1;

    const stages = getWorkflowStages();
    const def = stages[activeStageIdx];
    const stageTitle = def ? getTitle(def) : 'Review';
    lastJumpContext = { path, line, stageTitle };

    setMode('code');
    openFile(path, { line });

    const pill = $('#review-return-pill');
    if (pill) {
      pill.hidden = false;
      const lbl = $('#review-return-label');
      if (lbl) lbl.textContent = `Jumped from: ${stageTitle}`;
    }
  });
}

function wireAddStageModal() {
  const modal = $('#review-add-stage-modal');
  const addBtn = $('#btn-add-review-stage');
  const closeBtn = $('#add-stage-close');
  const cancelBtn = $('#add-stage-cancel');
  const submitBtn = $('#add-stage-submit');

  const titleIn = $('#add-stage-title-input');
  const qIn = $('#add-stage-q-input');
  const promptIn = $('#add-stage-prompt-input');

  const openAddModal = () => {
    if (!modal) return;
    if (titleIn) titleIn.value = '';
    if (qIn) qIn.value = '';
    if (promptIn) promptIn.value = '';
    modal.showModal();
    if (titleIn) titleIn.focus();
  };

  const closeAddModal = () => {
    if (modal) modal.close();
  };

  if (addBtn) addBtn.onclick = openAddModal;
  if (closeBtn) closeBtn.onclick = closeAddModal;
  if (cancelBtn) cancelBtn.onclick = closeAddModal;

  if (submitBtn) {
    submitBtn.onclick = async () => {
      const title = (titleIn?.value || '').trim();
      const q = (qIn?.value || '').trim();
      const prompt = (promptIn?.value || '').trim();

      if (!title) {
        showToast('error', 'Give the stage a title');
        return;
      }

      const stages = getWorkflowStages();
      const newStage = {
        id: `stage-${Date.now()}`,
        title: title,
        question: q || title,
        prompt: prompt || (q ? `Analyze the PR changes specifically for: ${q}. Highlight affected lines.` : `Review the PR for ${title}.`),
        passPreviousContext: true
      };

      stages.push(newStage);
      reviewConfig.stages = stages;
      if (reviewConfig.workflows?.[0]) {
        reviewConfig.workflows[0].stages = stages;
      }
      activeStageIdx = stages.length - 1;

      try {
        await saveConfigToServer();
        showToast(`Added stage: ${title}`, 'success', 2000);
        closeAddModal();
        renderPipeline();
        renderActiveStage();
      } catch (err) {
        showToast('error', err.message);
      }
    };
  }
}
