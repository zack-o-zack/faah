import { setMenuHidden } from './overlays.js';
// web/src/metricsview.js
// The status bar's CPU · RAM · LSP chip (#st-metrics) and the menu it opens
// (#metrics-menu). Shared by the app (through status.js) and the workbench
// page (workbench.js), so it depends on nothing but state.js.
import { $, esc } from './state.js';

export function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

const fmtCpu = m => `${(m.cpuUsage != null ? m.cpuUsage : 0).toFixed(1)}%`;

let lastMetrics = null;
let onMenuOpen = null;

const row = (label, val) => `
      <span data-ui="metrics-label" class="text-muted-foreground">${esc(label)}</span>
      <span data-ui="metrics-val" class="text-right tabular-nums">${val}</span>`;

// The two numbers people open this for, large; the rest stays small beneath them.
const stat = (label, val) => `
      <div data-ui="metrics-stat" class="flex flex-col">
        <span data-ui="metrics-val" class="text-lg font-semibold tabular-nums leading-tight">${val}</span>
        <span data-ui="metrics-label" class="text-xs text-muted-foreground">${esc(label)}</span>
      </div>`;

const grid = rows => `<div data-ui="metrics-grid" class="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 px-3 py-2 text-xs">${rows}</div>`;

// m.parts, when present (the workbench), breaks the totals down per process.
function renderMetricsMenu(m) {
  const menuEl = $('#metrics-menu');
  if (!menuEl || !m) return;
  const details = (m.lspEnabled && m.lspMemBytes ? row('Language servers', fmtBytes(m.lspMemBytes)) : '') +
    row('Goroutines', m.goroutines || 0);
  const parts = Array.isArray(m.parts) && m.parts.length > 1
    ? grid(m.parts.map(p => row(p.name, `${fmtBytes(p.rssBytes || 0)} · ${fmtCpu(p)}`)).join(''))
    : '';
  menuEl.innerHTML = `
    <div data-ui="metrics-stats" class="grid grid-cols-2 gap-6 px-3 pt-2.5 pb-2">${stat('Memory', fmtBytes(m.rssBytes || 0))}${stat('CPU', fmtCpu(m))}</div>
    <hr class="border-border">${grid(details)}${parts ? '<hr class="border-border">' + parts : ''}`;
}

export function closeMetricsMenu() {
  const menuEl = $('#metrics-menu');
  if (menuEl) setMenuHidden(menuEl, true);
}

function placeMetricsMenu() {
  const contEl = $('#st-metrics');
  const menuEl = $('#metrics-menu');
  if (!contEl || !menuEl) return;
  const r = contEl.getBoundingClientRect();
  menuEl.style.bottom = (innerHeight - r.top + 6) + 'px';
  menuEl.style.right = Math.max(8, innerWidth - r.right) + 'px';
  menuEl.style.left = 'auto';
}

export function toggleMetricsMenu() {
  const menuEl = $('#metrics-menu');
  if (!menuEl) return;
  if (!menuEl.hidden) {
    closeMetricsMenu();
    return;
  }
  if (lastMetrics) renderMetricsMenu(lastMetrics);
  setMenuHidden(menuEl, false);
  placeMetricsMenu();
  onMenuOpen?.();
}

// showMetrics paints the chip, and the menu if it is open.
export function showMetrics(m) {
  if (!m) return;
  lastMetrics = m;
  const cpuEl = $('#st-cpu');
  const ramEl = $('#st-ram');
  if (cpuEl) cpuEl.textContent = fmtCpu(m);
  if (ramEl) ramEl.textContent = fmtBytes(m.rssBytes || 0);
  const lspWrap = $('#st-lspmem-wrap');
  const lspEl = $('#st-lspmem');
  if (lspWrap) lspWrap.hidden = !m.lspEnabled;
  if (lspEl && m.lspEnabled) lspEl.textContent = fmtBytes(m.lspMemBytes || 0);
  const contEl = $('#st-metrics');
  if (contEl) {
    contEl.title = 'CPU ' + fmtCpu(m) + ' · RAM ' + fmtBytes(m.rssBytes || 0) +
      (m.lspEnabled ? ' · LSP ' + fmtBytes(m.lspMemBytes || 0) : '');
  }
  const menuEl = $('#metrics-menu');
  if (menuEl && !menuEl.hidden) {
    renderMetricsMenu(m);
    placeMetricsMenu();
  }
}

// initMetricsMenu wires the chip to its menu; refresh runs whenever it opens.
export function initMetricsMenu(refresh) {
  onMenuOpen = refresh;
  const contEl = $('#st-metrics');
  if (contEl) {
    contEl.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMetricsMenu();
    });
    contEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleMetricsMenu();
      }
    });
  }
  addEventListener('click', (e) => {
    const target = /** @type {HTMLElement|null} */ (e.target);
    if (!target?.closest('#metrics-menu, #st-metrics')) closeMetricsMenu();
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMetricsMenu();
  });
}
