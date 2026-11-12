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
  const verEl = $('#st-ver');
  if (verEl && S.meta?.version) {
    verEl.textContent = 'v' + S.meta.version;
    verEl.title = `faah v${S.meta.version} (Click for shortcuts & help)`;
  }
  drawLspStatus();
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

export function setLspState(j) {
  if (!j || !j.state) return;
  S.lsp.state = j.state;
  S.lsp.server = j.server || S.lsp.server;
  // Only file, warm and start replies say what is missing; any running server means nothing is.
  if ('missing' in j || j.state !== 'off') S.lsp.missing = j.missing || '';
  if ('anyRunning' in j) S.lsp.anyRunning = j.anyRunning;
  drawLspStatus();
}

// The last language server list fetched, and when the status chip last asked for one.
let lastLspData = null;
let lspCountAt = 0;

export function drawLspStatus() {
  const el = $('#st-lsp');
  if (!el) return;
  const servers = lastLspData?.servers || [];
  const running = servers.filter(s => s.running).length;
  const available = servers.filter(s => s.installed).length;
  const anyRunning = running > 0 || S.lsp.anyRunning || S.lsp.state === 'ready' || S.lsp.state === 'indexing';
  // A server started on its own since the list was fetched: fetch it again.
  if (anyRunning !== running > 0 && Date.now() - lspCountAt > 3000) {
    lspCountAt = Date.now();
    void refreshLspMenu();
  }
  let dot = 'bg-faint', title = 'Language servers: stopped (click to manage)';
  if (anyRunning) {
    dot = S.lsp.state === 'indexing' ? 'bg-warn' : 'bg-gi';
    title = `Language servers: ${running || 1} of ${available || running || 1} running (click to manage)`;
  } else if (S.lsp.state === 'failed') {
    dot = 'bg-gd';
    title = 'A language server failed (click to manage)';
  }
  // Counts appear once the server list is known and something is running.
  const count = anyRunning && available ? `<span class="tabular-nums">${running}/${available}</span> ` : '';
  el.innerHTML = `<span class="size-1.5 shrink-0 rounded-full ${dot}" aria-hidden="true"></span>${count}LSP`;
  el.title = title;
  el.setAttribute('aria-label', title);
}

function shortLang(lang) {
  if (!lang) return '';
  const m = {
    'TypeScript and JavaScript': 'TS / JS',
    'TypeScript': 'TS',
    'JavaScript': 'JS',
    'C and C++': 'C / C++',
  };
  return m[lang] || lang;
}

const lspMenuEl = $('#lsp-menu');
let lspPollTimer = null;
let pollActive = false;
const installingServers = new Set();

export function startLspPoll() {
  if (lspPollTimer) return;
  lspPollTimer = setInterval(async () => {
    if (pollActive) return;
    pollActive = true;
    try {
      const data = await api('/api/lsp/servers');
      if (data) {
        lastLspData = data;
        S.lsp.anyRunning = data.anyRunning;
        drawLspStatus();
        if (lspMenuEl && !lspMenuEl.hidden) {
          renderLspMenu(data);
          placeLspMenu();
        }

        // Auto-start any server that completed background installation
        for (const s of data.servers || []) {
          if (installingServers.has(s.name) && s.installed && !s.running && s.state !== 'installing') {
            installingServers.delete(s.name);
            showToast('success', `${s.name} installed. Starting…`);
            apiPost('/api/lsp/start', { server: s.name }).then(d => {
              if (d) {
                S.lsp.anyRunning = d.anyRunning;
                drawLspStatus();
                refreshLspMenu();
              }
            });
          }
        }

        const anyInstalling = (data.servers || []).some(s => s.state === 'installing');
        if (!anyInstalling && installingServers.size === 0) {
          clearInterval(lspPollTimer);
          lspPollTimer = null;
        }
      }
    } catch {}
    finally {
      pollActive = false;
    }
  }, 1200);
}

export function renderLspMenu(data) {
  if (!lspMenuEl || !data) return;
  lastLspData = data;
  const servers = data.servers || [];
  const anyRunning = !!data.anyRunning;

  let rows = '';
  if (servers.length === 0) {
    rows = `<div data-ui="lsp-empty-note" class="col-span-full py-2 text-muted-foreground">No language servers detected for workspace</div>`;
  } else {
    const act = (name, kind, label, cls) => `<button data-name="${esc(name)}" data-act="${kind}" title="${label} ${esc(name)}" aria-label="${label} ${esc(name)}" class="btn ${cls}" data-control="lsp-btn" data-variant="ghost" data-size="icon-xs"><span class="${kind === 'start' ? 'icon-[lucide--play]' : 'icon-[lucide--square]'} size-3" aria-hidden="true"></span></button>`;
    rows = servers.map(s => {
      // The dot carries the state (a spinner while it changes); text appears only
      // when it says something the dot cannot.
      let dot = 'bg-faint';
      let busy = false;
      let note = '';
      let btnHtml = '';

      if (s.state === 'installing' || installingServers.has(s.name)) {
        busy = true;
        btnHtml = '<span></span>';
      } else if (s.state === 'starting') {
        busy = true;
        btnHtml = act(s.name, 'stop', 'Stop', 'text-destructive');
      } else if (s.running) {
        dot = s.state === 'indexing' ? 'bg-warn' : 'bg-gi';
        note = s.memBytes ? fmtBytes(s.memBytes) : '';
        btnHtml = act(s.name, 'stop', 'Stop', 'text-destructive');
      } else if (s.state === 'failed') {
        dot = 'bg-gd';
        note = 'Failed';
        btnHtml = act(s.name, 'start', 'Restart', 'text-muted-foreground hover:text-foreground');
      } else if (s.installed) {
        btnHtml = act(s.name, 'start', 'Start', 'text-muted-foreground hover:text-foreground');
      } else {
        note = s.error ? 'Install failed' : 'Not installed';
        if (s.autoOpt !== undefined && s.autoOpt >= 0) {
          btnHtml = `<button data-name="${esc(s.name)}" data-opt="${s.autoOpt}" data-act="install" title="Install ${esc(s.name)}" class="btn" data-control="lsp-btn" data-variant="ghost" data-size="xs">Install</button>`;
        } else if (s.options && s.options.length > 0) {
          btnHtml = `<button data-cmd="${esc(s.options[0].cmd)}" data-act="copy" title="Copy install command: ${esc(s.options[0].cmd)}" class="btn" data-control="lsp-btn" data-variant="ghost" data-size="xs">Copy command</button>`;
        } else {
          btnHtml = '<span></span>';
        }
      }
      const dotHtml = busy
        ? '<span data-ui="lsp-dot" class="icon-[lucide--loader-circle] size-3 animate-spin text-muted-foreground" aria-label="Working"></span>'
        : `<span data-ui="lsp-dot" class="mx-0.5 size-2 rounded-full ${dot}"></span>`;

      return `
        <div data-ui="lsp-server-row" class="contents">
          ${dotHtml}
          <span data-ui="lsp-server-info" class="min-w-0 truncate"><span data-ui="lsp-server-name" class="font-medium">${esc(s.name)}</span> <span data-ui="lsp-server-lang" class="text-muted-foreground">${esc(shortLang(s.lang))}</span></span>
          <span data-ui="lsp-server-meta" class="max-w-40 truncate text-right tabular-nums text-muted-foreground" title="${esc(s.error || note)}">${esc(note)}</span>
          ${btnHtml}
        </div>
      `;
    }).join('');
  }

  lspMenuEl.innerHTML = `
    <div data-ui="lsp-menu-head" class="px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">Language servers</div>
    <div data-ui="lsp-server-list" class="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-3 gap-y-0.5 pl-2 text-xs">
      ${rows}
    </div>
  `;

  if (servers.some(s => s.state === 'installing')) {
    startLspPoll();
  }
}

/** Start every installed language server (command palette). */
export async function startAllLsp() {
  const data = await apiPost('/api/lsp/start', { server: 'all' });
  if (!data) return;
  lastLspData = data;
  S.lsp.anyRunning = data.anyRunning;
  drawLspStatus();
  if (lspMenuEl && !lspMenuEl.hidden) renderLspMenu(data);
}

/** Stop every running language server (command palette). */
export async function stopAllLsp() {
  const data = await apiPost('/api/lsp/stop');
  if (!data) return;
  lastLspData = data;
  S.lsp.anyRunning = data.anyRunning;
  S.lsp.state = 'off';
  drawLspStatus();
  if (lspMenuEl && !lspMenuEl.hidden) renderLspMenu(data);
}

export function closeLspMenu() {
  if (lspMenuEl) setMenuHidden(lspMenuEl, true);
}

function placeLspMenu() {
  const contEl = $('#st-lsp');
  if (!contEl || !lspMenuEl) return;
  const r = contEl.getBoundingClientRect();
  lspMenuEl.style.bottom = (innerHeight - r.top + 6) + 'px';
  lspMenuEl.style.right = Math.max(8, innerWidth - r.right) + 'px';
  lspMenuEl.style.left = 'auto';
}

export async function refreshLspMenu() {
  try {
    const data = await api('/api/lsp/servers');
    if (data) {
      lastLspData = data;
      S.lsp.anyRunning = data.anyRunning;
      drawLspStatus();
      if (lspMenuEl && !lspMenuEl.hidden) {
        renderLspMenu(data);
        placeLspMenu();
      }
    }
  } catch {}
}

export async function openLspMenu() {
  if (!lspMenuEl) return;
  closeMetricsMenu();
  setMenuHidden(lspMenuEl, false);
  placeLspMenu();
  try {
    const data = await api('/api/lsp/servers');
    renderLspMenu(data);
    placeLspMenu();
    S.lsp.anyRunning = data.anyRunning;
    drawLspStatus();
  } catch {
    lspMenuEl.innerHTML = `<div data-ui="lsp-empty-note" class="col-span-full py-2 text-muted-foreground">Failed to load language servers</div>`;
  }
}

export async function toggleLspMenu() {
  if (!lspMenuEl) return;
  if (!lspMenuEl.hidden) {
    closeLspMenu();
    return;
  }
  await openLspMenu();
}

export function initLspMenu() {
  void refreshLspMenu(); // the status chip counts running servers
  const contEl = $('#st-lsp');
  if (contEl) {
    contEl.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleLspMenu();
    });
    contEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleLspMenu();
      }
    });
  }

  if (lspMenuEl) {
    lspMenuEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      e.stopPropagation();

      const name = btn.dataset.name;
      const act = btn.dataset.act;
      if (!name || !act) return;

      btn.disabled = true;
      try {
        if (act === 'stop') {
          const data = await apiPost('/api/lsp/stop', { server: name });
          if (data) {
            S.lsp.anyRunning = data.anyRunning;
            if (S.lsp.server === name) S.lsp.state = 'off';
            renderLspMenu(data);
            drawLspStatus();
          }
        } else if (act === 'start') {
          const data = await apiPost('/api/lsp/start', { server: name });
          if (data) {
            S.lsp.anyRunning = data.anyRunning;
            renderLspMenu(data);
            drawLspStatus();
          }
        } else if (act === 'install') {
          const opt = btn.dataset.opt || '0';
          installingServers.add(name);
          try {
            await apiPost('/api/lsp/install', { server: name, option: opt });
            showToast('success', `Installing ${name} in background…`);
            startLspPoll();
            await refreshLspMenu();
          } catch (err) {
            installingServers.delete(name);
            showToast('error', err.message || 'Install failed');
            await refreshLspMenu();
          }
        } else if (act === 'copy') {
          const cmd = btn.dataset.cmd;
          if (cmd) copyToClipboard(cmd, `Copied ${cmd}`, btn);
        }
      } catch {}
    });
  }

  addEventListener('click', (e) => {
    const target = /** @type {HTMLElement|null} */ (e.target);
    if (!target?.closest('#lsp-menu, #st-lsp')) closeLspMenu();
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLspMenu();
  });
  window.addEventListener('resize', () => {
    if (lspMenuEl && !lspMenuEl.hidden) placeLspMenu();
  });
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
    drawLspStatus();
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
