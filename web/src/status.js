import { doc_, api, apiPost, withKeys, showToast } from './app/legacy-bridge.js';
import { setMenuHidden } from './overlays.js';
import { setPressed } from './controls.js';
import { $, S, esc } from './state.js';
import { previewing, previewKind } from './app/legacy-bridge.js';
import { copyToClipboard } from './ui.js';
import { fmtBytes, showMetrics, initMetricsMenu, closeMetricsMenu } from './metricsview.js';

export function updateStatus() {
  const d = doc_();
  const sizeEl = $('#st-size');
  if (sizeEl) sizeEl.textContent = d ? fmtBytes(d.size) : '';

  if (d && d.isImage) {
    const posEl = $('#st-pos');
    if (posEl) {
      const zoomText = d.image?.fit ? 'Fit' : `${Math.round((d.image?.scale || 1) * 100)}%`;
      posEl.textContent = d.imageMeta ? `${d.imageMeta.width} × ${d.imageMeta.height} px · ${zoomText}` : zoomText;
    }
  }

  // Markdown and CSV/TSV tabs share the preview switch; only its label differs.
  // Hidden while editing: the editor is the source, and the switch has nothing to show.
  const kind = d && d.isEditing ? '' : previewKind(d), isMd = !!kind, shown = previewing(d);
  const label = kind === 'table' ? 'Table' : 'Preview';
  const mdBtn = $('[data-action="md-preview"]');
  if (mdBtn) {
    mdBtn.hidden = !isMd;
    setPressed(mdBtn, shown);
    const l = $('.bar-action-label', mdBtn);
    if (l && isMd) l.textContent = label;
  }
}

let noteTimer = null;

export function setStatusNote(msg, timeoutMs = 0) {
  if (noteTimer) {
    clearTimeout(noteTimer);
    noteTimer = null;
  }
  const el = $('#st-pos');
  if (el) el.textContent = msg || '';
  if (msg && timeoutMs > 0) {
    noteTimer = setTimeout(() => {
      if (el && el.textContent === msg) el.textContent = '';
      noteTimer = null;
    }, timeoutMs);
  }
}

export function updateMetricsDisplay(m) {
  if (!m) return;
  showMetrics(m);
  if (m.lspEnabled !== undefined) {
    if (m.lspMemBytes > 0) {
      S.lsp.anyRunning = true;
    } else if (S.lsp.state !== 'indexing' && S.lsp.state !== 'starting') {
      S.lsp.anyRunning = false;
    }
    }
}

export async function refreshMetrics() {
  try {
    const m = await api('/api/metrics');
    updateMetricsDisplay(m);
  } catch {}
}

export function initMetrics() {
  initMetricsMenu(refreshMetrics);
}

/* The status bar stays on one line. When its contents outgrow the width, it
   sheds detail in steps (see the fit-N variants on #status), least useful first,
   stopping at the first step that fits. A step comes back only with FIT_SLACK px
   to spare, so a 1px wobble of a resizer cannot flip it on every move. */
const FIT_CLASSES = ['fit-1', 'fit-2', 'fit-3', 'fit-4', 'fit-5', 'fit-6'];
const FIT_STEPS = FIT_CLASSES.length, FIT_SLACK = 16;
const statusEl = $('#status');
const growEl = $('#status-spacer', statusEl);
let fitLevel = 0;
let appliedFit = -1;
let fitRAF = 0;

/* Apply fit level n and return the room left: the status spacer's width, or the
   overflow as a negative number. */
function applyFit(n) {
  if (n !== appliedFit) {
    FIT_CLASSES.forEach((className, index) => statusEl.classList.toggle(className, index < n));
    appliedFit = n;
  }
  return growEl.offsetWidth - (statusEl.scrollWidth - statusEl.clientWidth);
}

export function fitStatus() {
  let room = applyFit(fitLevel);
  while (fitLevel < FIT_STEPS && room < 0) room = applyFit(++fitLevel);
  // Showing more only ever shrinks the room, so stop as soon as it is short.
  while (fitLevel > 0 && room >= FIT_SLACK) {
    room = applyFit(fitLevel - 1);
    if (room < FIT_SLACK) { applyFit(fitLevel); return; }
    fitLevel--;
  }
}

function scheduleFitStatus() {
  if (fitRAF) return;
  fitRAF = requestAnimationFrame(() => {
    fitRAF = 0;
    fitStatus();
  });
}

export function initStatusFit() {
  // Width changes come from the window and the sidebar resizers; content changes
  // from metrics, LSP state and the selection bar. Class changes are not observed,
  // so fitStatus() toggling them cannot re-trigger itself.
  new ResizeObserver(fitStatus).observe(statusEl);
  new MutationObserver(scheduleFitStatus).observe(statusEl, { childList: true, subtree: true, characterData: true });
  document.fonts?.ready.then(fitStatus);
}
