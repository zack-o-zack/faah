import { setPressed } from './controls.js';
// web/src/thread.js
import { $, $$, S, esc, doc_, api, apiPost, apiPostJson, applyKeyLabels } from './state.js';
import { on } from './bus.js';
import { showToast, copyToClipboard } from './ui.js';
import { errorAlertHtml } from './errors.js';
import { openFile } from './tabs.js';
import { setThreadHandler, setExplainHandler, setExplainPrepareHandler, hideSelectionBar } from './selbar.js';
import { highlightRange } from './renderer.js';
import { linkTarget, explainEvidenceLine, explainStaleLabel } from './threadrefs.js';
import { hideRightInspector } from './inspector.js';
import { layout, render } from './renderer.js';
import { registerAgentPicker, reloadWorkspace } from './agent.js';
import { onStream, setStreamTopic, watchThread } from './stream.js';
import { clearPeeks, peeksHtml } from './notes-peek.js';
import { initOrb, orbBegin, orbAttach, orbFailed, orbThread, orbStep, orbSummary, orbSync } from './orb.js';

const COPY_ICON = '<span class="icon-[lucide--copy] size-3 shrink-0" aria-hidden="true"></span>';
const COPIED_ICON = '<span class="icon-[lucide--check] size-3 shrink-0" aria-hidden="true"></span>';

/* A thread is a long-running conversation with the coding harness, kept on the
   server. It starts from a spot in the code but is not limited to it: the
   harness may read and change any file, and each turn reports the files it
   touched beside its written reply. Every message continues the same
   conversation, so this is where to ask what code does and follow up, rather
   than one-shot inline edits.

   The right sidebar has two views: the list of threads, and one open thread
   (or a new draft) with its transcript and composer. Two feeds on the tab's
   shared event stream (stream.js) drive it: the list, which also tells the
   editor when a finished turn changed files so open tabs reload, and the open
   thread, carrying the reply as it is written. A dropped connection simply
   reconnects to a fresh snapshot of both. */

const thr = {
  avail: false,
  list: [],
  filter: 'all',      // all | file
  cur: null,          // the open thread, as last received
  draft: null,        // {path, l1, l2} for a thread not yet created, or {} for a workspace-level one
  opening: null,      // id of the thread being fetched, so a late reply for another one is dropped
  threadId: null,     // id of the thread whose live events we follow
  releaseThread: null,
  sending: false,
  stale: null,        // {id, reason} when /api/explain found the open explanation's surroundings changed
};

const thrRefText = t => t.path ? t.path + ':' + (t.l1 === t.l2 ? t.l1 : t.l1 + '-' + t.l2) : 'Workspace';

function thrAgo(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function thrDur(ms) {
  return ms < 1000 ? ms + 'ms' : ms < 60000 ? (ms / 1000).toFixed(1) + 's' : Math.floor(ms / 60000) + 'm ' + Math.round((ms % 60000) / 1000) + 's';
}

/* ---------- Markdown renderer for thread messages ----------
   Safe, streaming-friendly Markdown rendering supporting headings, code fences
   with syntax badge and copy button, blockquotes with GitHub alerts, ordered and
   unordered lists with task checkboxes and nesting, tables, links (with local file
   navigation), autolinks, images, horizontal rules, and inline styling. */
function thrSafeUrl(u) {
  u = u.trim();
  if (/^(?:https?|mailto):/i.test(u)) return esc(u);
  if (/^[a-zA-Z0-9_\-./]+(?::\d+(?:-\d+)?)?(?:#.*)?$/.test(u)) return esc(u);
  if (u.startsWith('#')) return esc(u);
  return '';
}

/* Set while rendering a finished explanation: only citations the server checked
   become links. Null everywhere else, which links anything path-shaped. */
let thrRefs = null;

function thrLinkAttrs(target, path, line, end) {
  const r = linkTarget(thrRefs, target, path, line, end);
  if (!r) return '';
  return `data-path="${esc(r.path)}"` + (r.line ? ` data-line="${r.line}"` : '') + (r.end ? ` data-end="${r.end}"` : '');
}

function thrInline(src) {
  if (!src) return '';
  const codes = [];
  // 1. Extract inline code spans first so nothing inside is formatted
  let s = src.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, q, code) => {
    const trimmed = code.trim();
    const m = /^([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+)(?::(\d+)(?:-(\d+))?)?$/.exec(trimmed);
    const attrs = m ? thrLinkAttrs(trimmed, m[1], m[2], m[3]) : '';
    if (attrs) {
      codes.push(`<code class="font-medium"><a href="#" class="thr-link cursor-pointer text-primary-text underline underline-offset-2 hover:text-primary" ${attrs}>${esc(trimmed)}</a></code>`);
    } else {
      codes.push('<code>' + esc(trimmed) + '</code>');
    }
    return '%%PXCODE' + (codes.length - 1) + '%%';
  });

  // Escape HTML in the remaining text
  s = esc(s);

  // 2. Bold, italic, strikethrough
  s = s.replace(/(\*\*\*|___)([^\n]+?)\1/g, '<strong><em>$2</em></strong>');
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^a-zA-Z0-9])__([^\n]+?)__(?![a-zA-Z0-9])/g, '$1<strong>$2</strong>');
  s = s.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
  s = s.replace(/(^|[^a-zA-Z0-9])_([^\n]+?)_(?![a-zA-Z0-9])/g, '$1<em>$2</em>');
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // 3. Links & images (use placeholders so bare autolinks do not match inside href/src attributes)
  const links = [];
  const pushLink = html => {
    links.push(html);
    return '%%PXLINK' + (links.length - 1) + '%%';
  };

  // Images: ![alt](url)
  s = s.replace(/!\[([^\]]*)\]\(((?:[^()]|\([^()]*\))*)\)/g, (_, alt, url) => {
    const u = thrSafeUrl(url);
    return u ? pushLink(`<img src="${u}" alt="${esc(alt)}" class="thr-img" />`) : esc(alt);
  });

  // Links: [text](url)
  s = s.replace(/\[([^\]]+)\]\(((?:[^()]|\([^()]*\))*)\)/g, (_, text, url) => {
    const u = thrSafeUrl(url);
    if (!u) return text;
    const m = /^([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+)(?::(\d+)(?:-(\d+))?)?$/.exec(url.trim());
    if (m && !url.includes('://')) {
      const attrs = thrLinkAttrs(url.trim(), m[1], m[2], m[3]);
      return attrs ? pushLink(`<a href="#" class="thr-link cursor-pointer text-primary-text underline underline-offset-2 hover:text-primary" ${attrs}>${text}</a>`) : text;
    }
    return pushLink(`<a href="${u}" target="_blank" rel="noopener noreferrer">${text}</a>`);
  });

  // Bare file:line in prose: e.g. "at agent.go:120"
  s = s.replace(/(^|[\s(])([a-zA-Z0-9_.\-/]+\.[a-zA-Z0-9]+):(\d+)(?:-(\d+))?(?=[\s),.;:!?]|$)/g, (_, prefix, path, line, end) => {
    const shown = path + ':' + line + (end ? '-' + end : '');
    const attrs = thrLinkAttrs(shown, path, line, end);
    return prefix + (attrs ? pushLink(`<a href="#" class="thr-link cursor-pointer text-primary-text underline underline-offset-2 hover:text-primary" ${attrs}>${esc(shown)}</a>`) : esc(shown));
  });

  // 4. Bracketed autolinks: <https://...>
  s = s.replace(/&lt;(https?:\/\/[^&>]+)&gt;/g, (_, url) => {
    const u = thrSafeUrl(url);
    return u ? pushLink(`<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`) : url;
  });

  // 5. Bare autolinks
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, prefix, url) => {
    let trailing = '';
    const m = /[.,:;?!]+$/.exec(url);
    if (m) {
      trailing = m[0];
      url = url.slice(0, -trailing.length);
    }
    const u = thrSafeUrl(url);
    return u ? `${prefix}` + pushLink(`<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`) + trailing : prefix + url + trailing;
  });

  // 6. Restore links & codes
  s = s.replace(/%%PXLINK(\d+)%%/g, (_, idx) => links[+idx]);
  s = s.replace(/%%PXCODE(\d+)%%/g, (_, idx) => codes[+idx]);

  return s;
}

/** Markdown outside the reply, such as a note's detail, linking only the
    citations that were checked against the code. */
export function thrMdRefs(src, refs) {
  thrRefs = refs || {};
  try { return thrMd(src); } finally { thrRefs = null; }
}

/** Opens a citation link's file at its lines. @param {HTMLElement} link */
export function thrOpenLink(link) {
  const { path, line, end } = link.dataset;
  if (!path) return;
  openFile(path, { line: +line || 1 }).then(() => { if (end) highlightRange(path, +line, +end); });
}

export function thrMd(src) {
  if (!src) return '';
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let html = '';
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // Fenced code block: ``` or ~~~
    const fenceMatch = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[2][0];
      const markerLen = fenceMatch[2].length;
      const rawLang = fenceMatch[3].trim().split(/\s+/)[0] || '';
      const lang = /^[\w+#.-]+$/.test(rawLang) ? rawLang : '';
      const codeLines = [];
      i++;
      while (i < lines.length) {
        const endMatch = new RegExp('^( {0,3})' + marker + '{' + markerLen + ',}\\s*$').exec(lines[i]);
        if (endMatch) { i++; break; }
        codeLines.push(lines[i]);
        i++;
      }
      const code = esc(codeLines.join('\n'));
      html += `<div class="thr-pre"` + (lang ? ` data-lang="${esc(lang)}"` : '') + `><pre><code>` + code + `</code></pre><button title="Copy code" aria-label="Copy code" class="btn absolute top-2 right-2" data-control="thr-copy" data-variant="ghost" data-size="icon-xs">` + COPY_ICON + `</button></div>`;
      continue;
    }

    // Heading: #{1,6}
    const hMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hMatch) {
      const level = hMatch[1].length;
      html += `<h${level}>` + thrInline(hMatch[2]) + `</h${level}>`;
      i++;
      continue;
    }

    // Horizontal rule: ---, ***, ___
    if (/^( {0,3})([-*_])(?:\s*\2){2,}\s*$/.test(line)) {
      html += '<hr>';
      i++;
      continue;
    }

    // Blockquote: >
    if (/^( {0,3})>(?: (.*)|(.*))$/.test(line)) {
      const qLines = [];
      while (i < lines.length) {
        const qm = /^( {0,3})>(?: (.*)|(.*))$/.exec(lines[i]);
        if (qm) {
          qLines.push(qm[2] !== undefined ? qm[2] : qm[3] || '');
          i++;
        } else if (lines[i].trim() && !/^( {0,3})([#`~*-]|\d+\.)/.test(lines[i])) {
          qLines.push(lines[i]);
          i++;
        } else {
          break;
        }
      }
      let alertClass = '';
      let alertTitle = '';
      if (qLines.length > 0) {
        const am = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i.exec(qLines[0]);
        if (am) {
          const kind = am[1].toLowerCase();
          const titles = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' };
          const alertClasses = {
            note: 'thr-alert thr-alert-note', tip: 'thr-alert thr-alert-tip', important: 'thr-alert thr-alert-important',
            warning: 'thr-alert thr-alert-warning', caution: 'thr-alert thr-alert-caution',
          };
          alertClass = alertClasses[kind];
          alertTitle = `<p class="thr-alert-title">${titles[kind]}</p>`;
          qLines.shift();
        }
      }
      const inner = thrMd(qLines.join('\n'));
      html += `<blockquote class="${alertClass}">${alertTitle}${inner}</blockquote>`;
      continue;
    }

    // Table
    if (line.includes('|') && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      const isDelim = /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(nextLine);
      if (isDelim) {
        const splitRow = r => {
          let s = r.trim();
          if (s.startsWith('|')) s = s.slice(1);
          if (s.endsWith('|')) s = s.slice(0, -1);
          return s.split('|').map(c => c.trim());
        };
        const headers = splitRow(line);
        const delims = splitRow(nextLine);
        const aligns = delims.map(d => {
          const left = d.startsWith(':');
          const right = d.endsWith(':');
          if (left && right) return 'center';
          if (right) return 'right';
          if (left) return 'left';
          return '';
        });
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        let tbl = '<table><thead><tr>';
        headers.forEach((h, col) => {
          const align = aligns[col] ? ` style="text-align:${aligns[col]}"` : '';
          tbl += `<th${align}>${thrInline(h)}</th>`;
        });
        tbl += '</tr></thead><tbody>';
        rows.forEach(r => {
          tbl += '<tr>';
          headers.forEach((_, col) => {
            const val = r[col] || '';
            const align = aligns[col] ? ` style="text-align:${aligns[col]}"` : '';
            tbl += `<td${align}>${thrInline(val)}</td>`;
          });
          tbl += '</tr>';
        });
        tbl += '</tbody></table>';
        html += tbl;
        continue;
      }
    }

    // List: unordered (*, -, +) or ordered (1.)
    const listMatch = /^( *)([-*+]|\d+[.)]) +(.*)$/.exec(line);
    if (listMatch) {
      const listStack = [];
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j++;
          if (j < lines.length && /^( *)([-*+]|\d+[.)]) +(.*)$/.test(lines[j])) {
            i++;
            continue;
          }
          break;
        }

        const itemMatch = /^( *)([-*+]|\d+[.)]) +(.*)$/.exec(l);
        if (itemMatch) {
          const indent = itemMatch[1].length;
          const marker = itemMatch[2];
          const isOrdered = /^\d/.test(marker);
          const type = isOrdered ? 'ol' : 'ul';
          let itemText = itemMatch[3];

          let taskInput = '';
          const taskMatch = /^\[([ xX])\] +(.*)$/.exec(itemText);
          if (taskMatch) {
            const checked = taskMatch[1].toLowerCase() === 'x';
            taskInput = `<input type="checkbox" disabled${checked ? ' checked' : ''} class="input"> `;
            itemText = taskMatch[2];
          }

          while (listStack.length && indent < listStack[listStack.length - 1].indent) {
            const popped = listStack.pop();
            html += `</li></${popped.type}>`;
          }

          if (!listStack.length || indent > listStack[listStack.length - 1].indent) {
            html += `<${type}><li class="${taskInput ? 'thr-task-item' : ''}">` + taskInput + thrInline(itemText);
            listStack.push({ type, indent });
          } else {
            if (listStack[listStack.length - 1].type !== type) {
              const popped = listStack.pop();
              html += `</li></${popped.type}><${type}>`;
              listStack.push({ type, indent });
            } else {
              html += `</li><li class="${taskInput ? 'thr-task-item' : ''}">` + taskInput + thrInline(itemText);
            }
          }
          i++;
        } else {
          const indentMatch = /^( *)/.exec(l);
          const isIndented = indentMatch[1].length > listStack[listStack.length - 1].indent;
          if (isIndented && !/^( {0,3})([`~]{3,}|#{1,6}\s|>)/.test(l)) {
            html += '<br>' + thrInline(l.trim());
            i++;
          } else if (!isIndented && !/^( {0,3})([#`~>]|[-*_]{3,})/.test(l) && !l.includes('|')) {
            html += '<br>' + thrInline(l.trim());
            i++;
          } else {
            break;
          }
        }
      }

      while (listStack.length) {
        const popped = listStack.pop();
        html += `</li></${popped.type}>`;
      }
      continue;
    }

    // Paragraph: collect lines until blank line or block start
    const pLines = [];
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) break;
      if (/^( {0,3})(`{3,}|~{3,})/.test(l)) break;
      if (/^#{1,6}\s+/.test(l)) break;
      if (/^( {0,3})([-*_])(?:\s*\2){2,}\s*$/.test(l)) break;
      if (/^( {0,3})>/.test(l)) break;
      if (/^( *)([-*+]|\d+[.)]) +/.test(l)) break;
      if (l.includes('|') && i + 1 < lines.length && /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(lines[i + 1])) break;

      pLines.push(l);
      i++;
    }
    if (pLines.length) {
      html += '<p>' + pLines.map(thrInline).join('<br>') + '</p>';
    }
  }
  return html;
}

/* ---------- list view ---------- */

export function showThreadsSidebar() {
  hideRightInspector();
  document.body.classList.remove('threads-hidden');
  setPressed($('#btn-top-threads'), true);
  if (!thr.cur && !thr.draft) thrShow('list');
  thrDrawList();
  layout();
  render();
}

export function hideThreadsSidebar() {
  document.body.classList.add('threads-hidden');
  setPressed($('#btn-top-threads'), false);
  layout();
  render();
}

export function toggleThreadsSidebar() {
  if (document.body.classList.contains('threads-hidden')) {
    showThreadsSidebar();
  } else {
    hideThreadsSidebar();
  }
}

const thrEl = {};

function thrShow(view) {
  thrEl.listView.hidden = view !== 'list';
  thrEl.threadView.hidden = view !== 'thread';
  orbSync();
}

function thrVisible() {
  const d = doc_();
  return thr.list.filter(t => thr.filter !== 'file' || (d && t.path === d.path));
}

function thrDrawList() {
  if (!thrEl.list) return;
  const items = thrVisible();
  const running = thr.list.some(t => t.running);
  $$('[data-ui~=thr-tab-dot]').forEach(dot => {
    dot.hidden = !running;
  });
  if (!items.length) {
    thrEl.list.innerHTML = '<div data-ui="hint" class="empty text-muted-foreground">' + (thr.filter === 'file'
      ? 'No threads started in this file. Select code and press <b data-keys="Alt+T"></b> to start one.'
      : 'No threads yet. Select code and press <b data-keys="Alt+T"></b>, or use New to start a long-running conversation.') + '</div>';
    applyKeyLabels(thrEl.list);
    return;
  }
  thrEl.list.innerHTML = items.map(t =>
    '<div data-ui="thr-item" class="item group flex-col items-stretch gap-1 cursor-pointer hover:bg-accent [&.sel]:bg-accent' + (thr.cur && thr.cur.id === t.id ? ' sel' : '') + '" data-size="xs" data-id="' + esc(t.id) + '" role="button" tabindex="0">' +
    '<div data-ui="thr-item-title" class="flex min-w-0 items-center gap-2 text-sm font-medium">' +
      (t.running ? '<span data-ui="thr-spin" class="icon-[lucide--loader-circle] size-3.5 shrink-0 animate-spin text-muted-foreground" title="Working"></span>'
        : t.failed ? '<span data-ui="thr-fail" class="icon-[lucide--circle-alert] size-3.5 shrink-0 text-destructive" title="Last reply failed"></span>' : '') +
      '<span data-ui="thr-item-title-text" class="min-w-0 flex-1 truncate">' + esc(t.title) + '</span>' +
      (t.kind ? '<span class="badge" data-variant="secondary" data-control="thr-kind">' + (t.kind === 'batch' || t.kind === 'explain' ? t.kind : 'inline') + '</span>' : '') +
      '<button data-del="' + esc(t.id) + '" title="Delete this thread" aria-label="Delete thread" class="btn opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100" data-control="thr-item-del mini" data-variant="ghost" data-size="icon-xs"><span class="icon-[lucide--trash-2] size-3 shrink-0" aria-hidden="true"></span></button>' +
    '</div>' +
    '<div data-ui="thr-item-meta" class="flex justify-between gap-2 text-xs text-muted-foreground"><span data-ui="thr-item-ref" class="truncate font-mono">' + esc(thrRefText(t)) + '</span>' +
    '<span class="shrink-0">' + t.turns + (t.turns === 1 ? ' turn' : ' turns') + ' · ' + thrAgo(t.updated) + '</span></div></div>').join('');
}

function thrApplyList(next) {
  const was = new Map(thr.list.map(t => [t.id, t.running]));
  thr.list = next;
  // A turn that just finished may have rewritten files under open tabs.
  if (next.some(t => was.get(t.id) && !t.running && t.touched)) reloadWorkspace(null, 'Thread');
  thrDrawList();
}

function thrConnectList() {
  onStream('threads:list', thrApplyList);
  onStream('threads:summary', sm => {
    const next = thr.list.filter(t => t.id !== sm.id);
    next.push(sm);
    next.sort((a, b) => b.updated - a.updated);
    thrApplyList(next);
    orbSummary(sm);
  });
  onStream('threads:deleted', ({ id }) => {
    thrApplyList(thr.list.filter(t => t.id !== id));
  });
  setStreamTopic('threads', true);
}

/* ---------- thread view ---------- */

function thrCloseStream() {
  thr.releaseThread?.();
  thr.releaseThread = null;
  thr.threadId = null;
}

const thrRunning = () => !!(thr.cur && thr.cur.turns.length && thr.cur.turns[thr.cur.turns.length - 1].running);

function thrRenderAnchor() {
  const t = thr.cur || thr.draft;
  const el = thrEl.anchor;
  thrEl.input.placeholder = t && t.path ? 'Ask about this code, or ask for changes anywhere' : 'Ask about this workspace, or ask for changes';
  // A workspace thread has nothing to point at; its placeholder says so.
  if (!t || !t.path) {
    el.hidden = true;
    el.classList.remove('jump');
    delete el.dataset.path;
    return;
  }
  el.hidden = false;
  el.classList.add('jump');
  el.dataset.path = t.path;
  el.dataset.line = t.l1;
  el.querySelector('[data-ui~=thr-anchor-text]').textContent = thrRefText(t);
  el.title = 'Jump to this code';
}

// The evidence an explanation rests on, and how to get a new one.
function thrExplainFoot() {
  const t = thr.cur;
  let h = '<div data-ui="thr-evidence" class="flex items-center flex-wrap gap-2 font-mono text-muted-foreground"><span>' + esc(explainEvidenceLine(t.evidence)) + '</span>';
  if (thr.stale && thr.stale.id === t.id) {
    h += '<span data-ui="thr-stale" class="">' + esc(explainStaleLabel(thr.stale.reason)) + '</span>' +
      '<button type="button" data-explain-again class="btn" data-control="thr-evidence-btn" data-variant="outline" data-size="xs">Refresh</button>';
  } else if (t.explainReq) {
    h += '<button type="button" data-explain-again class="btn" data-control="thr-evidence-btn" data-variant="outline" data-size="xs">Re-explain</button>';
  }
  return h + '</div>';
}

function thrReplyHtml(turn) {
  thrRefs = thr.cur?.kind === 'explain' && !turn.running ? (turn.refs || {}) : null;
  try { return thrMd(turn.reply || ''); } finally { thrRefs = null; }
}

/* The steps a turn took. While it runs, the latest one is its status line;
   once it is done they fold under a count. */
function thrStepsHtml(turn, open = false) {
  const tools = turn.tools || [];
  if (!turn.running && !tools.length) return '';
  const head = turn.running
    ? '<span class="icon-[lucide--loader-circle] mt-px size-3 shrink-0 animate-spin" aria-hidden="true"></span><span class="line-clamp-2 min-w-0 wrap-anywhere">' + esc(tools[tools.length - 1] || 'Starting') + '</span>'
    : '<span class="icon-[lucide--chevron-right] mt-px size-3 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true"></span>' + tools.length + (tools.length === 1 ? ' step' : ' steps');
  if (!tools.length) return '<div data-ui="thr-steps" class="flex items-start gap-1.5 text-xs text-muted-foreground">' + head + '</div>';
  return '<details data-ui="thr-steps" class="group text-xs text-muted-foreground [&::details-content]:overflow-hidden"' + (open ? ' open' : '') + '>' +
    '<summary class="flex cursor-pointer list-none items-start gap-1.5 hover:text-foreground [&::-webkit-details-marker]:hidden">' + head + '</summary>' +
    '<ol data-ui="thr-step-list" class="mt-1.5 ml-1.5 flex flex-col gap-1 border-l pl-3">' + tools.map(x => '<li class="whitespace-pre-wrap wrap-anywhere">' + esc(x) + '</li>').join('') + '</ol></details>';
}

/* What an explanation showed on the code through its tools, listed with links
   to the lines. */
function thrShownHtml(turn) {
  const where = (p, l1, l2) => '<span class="font-mono text-muted-foreground">' + esc(p) + ':' + l1 + (l2 > l1 ? '-' + l2 : '') + '</span>';
  const link = (p, l1, l2, inner, cls) => '<a href="#" class="thr-link ' + cls + '" data-path="' + esc(p) + '" data-line="' + l1 + '"' +
    (l2 > l1 ? ' data-end="' + l2 + '"' : '') + '>' + inner + '</a>';
  const box = (head, body) => '<div data-ui="thr-shown" class="rounded-md border px-2 py-1.5 text-xs"><div class="mb-1 font-mono text-muted-foreground">' + head + '</div>' + body + '</div>';
  let h = '';
  const notes = turn.notes || [];
  if (notes.length) {
    const list = box(notes.length + (notes.length === 1 ? ' note' : ' notes') + ' on the code',
      notes.map(n => link(n.path, n.l1, n.l2, where(n.path, n.l1, n.l2) + ' ' + esc(n.summary), 'block py-px no-underline hover:text-primary-text')).join(''));
    // Once the turn ends, the list becomes peeks of the code, as the editor shows it.
    h += turn.running || !thr.cur ? list : peeksHtml(thr.cur.id, turn, list, src => thrMdRefs(src, turn.refs));
  }
  for (const w of turn.walkthroughs || []) {
    h += box('Walkthrough: ' + esc(w.title), '<ol class="list-decimal pl-4">' +
      w.steps.map(s => '<li>' + link(s.path, s.l1, s.l2, esc(s.title), 'text-primary-text') + ' <span class="text-foreground">' + esc(s.body) + '</span></li>').join('') + '</ol>');
  }
  return h;
}

function thrTurnHtml(turn) {
  let h = '<div data-ui="thr-msg" class="thr-user ml-8 self-end min-w-0 rounded-lg bg-muted px-3 py-2 text-sm"><div class="thr-body">' + thrMd(turn.prompt) + '</div></div>';
  h += '<div data-ui="thr-msg" class="thr-agent flex min-w-0 flex-col gap-2 text-sm" data-turn="' + turn.id + '"><div data-ui="thr-who" class="text-xs text-muted-foreground">' + esc(turn.harness || 'agent') +
    (turn.model ? ' · ' + esc(turn.model) : '') +
    (!turn.running && turn.ms ? ' · <span' + (turn.firstMs ? ' title="First words after ' + thrDur(turn.firstMs) + '"' : '') + '>' + thrDur(turn.ms) + '</span>' : '') + '</div>';
  h += thrStepsHtml(turn);
  h += '<div class="thr-body thr-reply">' + thrReplyHtml(turn) + '</div>';
  h += thrShownHtml(turn);
  if (turn.error) h += errorAlertHtml(turn.error, { title: 'The run failed' });
  if (thr.cur?.kind === 'explain' && turn.id === 1 && !turn.running) h += thrExplainFoot();
  if (!turn.running) {
    if (turn.changed && turn.changed.length) {
      const revertHtml = turn.beforeSha
        ? (turn.reverted
          ? '<span class="badge" data-variant="outline" data-control="thr-reverted-badge">Reverted</span>'
          : '<button type="button" data-revert-turn="' + turn.id + '" title="Revert files modified in this turn back to pre-turn snapshot" class="btn" data-control="thr-revert-btn" data-variant="outline" data-size="xs">Revert turn</button>')
        : '';
      h += '<div data-ui="thr-changed" class="flex items-center flex-wrap gap-2"><div data-ui="thr-changed-head" class="flex items-center justify-between w-full gap-2"><span data-ui="thr-changed-label" class="text-xs text-muted-foreground">' + (thr.cur?.kind === 'explain' ? 'Files changed during this explanation' : 'Changed ' + turn.changed.length + (turn.changed.length === 1 ? ' file' : ' files')) + '</span>' + revertHtml + '</div>' +
        turn.changed.map(p => '<button data-path="' + esc(p) + '" data-turn-id="' + turn.id + '" title="Review changes in ' + esc(p) + '" class="btn max-w-full font-mono" data-control="thr-file" data-variant="outline" data-size="xs"><span class="icon-[lucide--file-diff] size-3" aria-hidden="true"></span><span class="truncate">' + esc(p) + '</span></button>').join('') + '</div>';
    } else if (turn.tracked === false) {
      h += '<div data-ui="thr-changed" class="flex items-center flex-wrap gap-2"><span data-ui="thr-changed-label" class="text-xs text-muted-foreground">Changes unknown outside a git repository; the workspace was reloaded.</span></div>';
    }
  }
  return h + '</div>';
}

function thrRenderMsgs() {
  const box = thrEl.msgs;
  const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  const turns = thr.cur ? thr.cur.turns : [];
  box.innerHTML = turns.length ? turns.map(thrTurnHtml).join('')
    : '<div data-ui="hint" class="empty text-muted-foreground">' + (thr.draft && thr.draft.path
      ? 'Ask a question about this code, or ask for changes. The reply can touch any file.'
      : 'Ask anything about this workspace. The reply can touch any file.') + '</div>';
  if (stick) box.scrollTop = box.scrollHeight;
}

/* PR review: what the thread is about. The default comes from where you are --
   the editor section a selection was made in, then the sidebar's Not pushed / PR
   changes switch, else the whole PR -- and the chips override it. */
function thrDefaultScope(info) {
  const sel = getSelection();
  const sec = (sel && sel.anchorNode ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement) : null)?.closest?.('.diff-section');
  if (sec?.classList.contains('diff-section-you')) return 'mine';
  if (sec?.classList.contains('diff-section-pr')) return 'pr';
  return $('#tree')?.classList.contains('scope-yours') ? 'mine' : 'pr';
}

function thrRenderScope() {
  const el = $('#thr-scope');
  if (!el) return;
  const t = thr.cur || thr.draft;
  el.hidden = !S.meta?.pr || !t;
  if (el.hidden) return;
  const scope = t.scope || 'pr';
  const anchored = !!t.path;
  for (const b of el.querySelectorAll('button[data-scope]')) {
    const on_ = b.dataset.scope === scope;
    setPressed(b, on_);
    b.setAttribute('aria-pressed', on_ ? 'true' : 'false');
    if (b.dataset.scope === 'selection') b.disabled = !anchored;
  }
}

async function thrPickScope(scope) {
  if (thr.cur) {
    try { thr.cur = await apiPostJson('/api/threads/scope', { id: thr.cur.id, scope }); }
    catch (e) { showToast('error', e.message); return; }
  } else if (thr.draft) {
    thr.draft.scope = scope;
  }
  thrRenderScope();
}

// One button sends, and stops the reply while one runs.
function thrSyncSend() {
  const running = thrRunning();
  const b = thrEl.send;
  const label = running ? 'Stop this reply' : 'Send (Enter)';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.firstElementChild.className = running ? 'size-2.5 rounded-[2px] bg-current' : 'icon-[lucide--arrow-up] size-4';
  b.disabled = !running && (thr.sending || !thrEl.input.value.trim());
}

function thrRenderState() {
  const running = thrRunning();
  thrEl.title.textContent = thr.cur ? thr.cur.title : 'New thread';
  thrEl.del.hidden = !thr.cur;
  thrSyncSend();
  thrEl.hint.textContent = running ? 'The stop button ends this reply early' : 'Enter to send · Shift+Enter for a new line';
  thrRenderAnchor();
  thrRenderScope();
  thrRenderMsgs();
  thrDrawList();
}

function thrOpenStream(id) {
  thrCloseStream();
  thr.threadId = id;
  thr.releaseThread = watchThread(id);
}

// Live events for the open thread arrive as {id, data}; anything for a thread
// we have since left is dropped.
function thrWireStream() {
  const mine = d => thr.threadId === d.id;
  onStream('thread:thread', d => {
    orbThread(d.data);
    if (!mine(d)) return;
    thr.cur = d.data;
    thrRenderState();
  });
  let deltaRAF = 0;
  const dirtyTurns = new Set();
  onStream('thread:delta', ({ id, data: d }) => {
    if (thr.threadId !== id || !thr.cur) return;
    const turn = thr.cur.turns.find(x => x.id === d.turn);
    if (!turn) return;
    turn.reply = (turn.reply || '') + d.text;
    dirtyTurns.add(d.turn);
    if (deltaRAF) return;
    deltaRAF = requestAnimationFrame(() => {
      deltaRAF = 0;
      if (!thr.threadId || !thr.cur) { dirtyTurns.clear(); return; }
      const box = thrEl.msgs;
      const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
      for (const turnId of dirtyTurns) {
        const t = thr.cur.turns.find(x => x.id === turnId);
        if (!t) continue;
        const body = box.querySelector('.thr-agent[data-turn="' + turnId + '"] .thr-reply');
        if (body) body.innerHTML = thrMd(t.reply);
      }
      dirtyTurns.clear();
      if (stick) box.scrollTop = box.scrollHeight;
    });
  });
  onStream('thread:tool', ({ id, data: d }) => {
    orbStep(id, d.text);
    if (thr.threadId !== id || !thr.cur) return;
    const turn = thr.cur.turns.find(x => x.id === d.turn);
    if (!turn) return;
    (turn.tools = turn.tools || []).push(d.text);
    const box = thrEl.msgs;
    const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    const msg = box.querySelector('.thr-agent[data-turn="' + d.turn + '"]');
    if (msg) {
      const old = msg.querySelector('[data-ui~=thr-steps]');
      const open = !!old?.open;
      old?.remove();
      msg.querySelector('[data-ui~=thr-who]').insertAdjacentHTML('afterend', thrStepsHtml(turn, open));
    }
    if (stick) box.scrollTop = box.scrollHeight;
  });
  onStream('thread:deleted', d => { if (mine(d)) thrBack(); });
}

export async function openThread(id) {
  clearPeeks();
  thr.draft = null;
  thr.cur = null;
  thrCloseStream();
  showThreadsSidebar();
  thrShow('thread');
  thrEl.msgs.innerHTML = '<div data-ui="hint" class="empty text-muted-foreground">Loading…</div>';
  thrEl.title.textContent = 'Thread';
  thrEl.del.hidden = true;
  thr.opening = id;
  // A plain request shows a saved thread at once. The live stream is only for
  // a turn still being written, so browsing past threads never waits on it.
  try {
    const t = await api('/api/threads/get', { id });
    if (thr.opening !== id) return;
    thr.cur = t;
    thrRenderState();
    if (thrRunning()) thrOpenStream(id);
  } catch (e) {
    if (thr.opening !== id) return;
    thrEl.msgs.innerHTML = '<div data-ui="hint" class="empty text-muted-foreground">Could not load this thread: ' + esc(e.message) + '</div>';
  }
}

function thrBack() {
  thr.opening = null;
  thrCloseStream();
  thr.cur = null;
  thr.draft = null;
  thrShow('list');
  thrDrawList();
}

/* Starts a draft: anchored to info's range, or to the workspace when info is
   omitted. Nothing is created on the server until the first message is sent. */
export function newThread(info) {
  if (!thr.avail) { showToast('error', 'Threads need a coding harness: run faah without -no-agent'); return; }
  thr.opening = null;
  thrCloseStream();
  thr.cur = null;
  thr.draft = info && info.path ? { path: info.path, l1: info.l1, l2: info.l2 } : {};
  if (S.meta?.pr) thr.draft.scope = thrDefaultScope(info);
  showThreadsSidebar();
  thrShow('thread');
  thrRenderState();
  if (info) hideSelectionBar();
  thrEl.input.focus();
}

/* Asks the server for an explanation of this selection. It answers with a saved
   thread when the code has not changed, or a new one already running. The
   thread view is prepared behind the closed sidebar while the orb shows
   progress; opening the sidebar shows it. */
async function thrExplain(body) {
  const token = 'explain:' + Date.now();
  thr.opening = token;
  thr.draft = null;
  thr.cur = null;
  thr.stale = null;
  thrCloseStream();
  orbBegin();
  thrShow('thread');
  thrEl.title.textContent = 'Explain';
  thrEl.del.hidden = true;
  thrEl.anchor.hidden = true;
  thrEl.msgs.innerHTML = '<div data-ui="hint" class="empty text-muted-foreground">Reading code…</div>';
  try {
    const j = await apiPostJson('/api/explain', body);
    if (thr.opening !== token) return;
    thr.opening = null;
    thr.cur = j.thread;
    if (j.stale) thr.stale = { id: j.thread.id, reason: j.staleReason };
    thrRenderState();
    orbAttach(j.thread);
    if (thrRunning() || !j.thread.turns.length) thrOpenStream(j.thread.id);
  } catch (e) {
    if (thr.opening !== token) return;
    thr.opening = null;
    orbFailed(e.message);
    thrEl.msgs.innerHTML = '<div data-ui="hint" class="empty text-muted-foreground">' + esc(e.message) + '</div>';
  }
}

/* Fire and forget: the server gathers evidence in the background and Explain
   picks it up. Nothing here waits, and a failure costs only the head start. */
let lastPrepared = '';
function prepareExplain(info) {
  const d = doc_();
  if (!d || d.path !== info.path || d.dirty) return;
  if (info.l2 - info.l1 >= 400 || info.text.length > 20000) return;
  const { path, l1, c1, l2, c2, text } = info;
  const key = [path, l1, c1, l2, c2, text].join('\u0000');
  if (key === lastPrepared) return;
  lastPrepared = key;
  apiPostJson('/api/explain/prepare', { path, l1, c1, l2, c2, text }).catch(() => { lastPrepared = ''; });
}

/** Explains code again, even when a saved explanation of it exists. */
export function explainAgain(body) {
  thrExplain({ ...body, force: true });
}

export function explainSelection(info) {
  const d = doc_();
  if (d && d.path === info.path && d.dirty) { showToast('error', 'Save the file to explain the current code'); return; }
  const { path, l1, c1, l2, c2, text } = info;
  thrExplain({ path, l1, c1, l2, c2, text });
}

async function thrSend() {
  const message = thrEl.input.value.trim();
  if (!message || thr.sending || thrRunning()) return;
  thr.sending = true;
  thrSyncSend();
  try {
    if (thr.draft) {
      const t = await apiPostJson('/api/threads/create', { ...thr.draft, message });
      thr.draft = null;
      thr.cur = t;
      thrOpenStream(t.id);
    } else if (thr.cur) {
      await apiPostJson('/api/threads/send', { id: thr.cur.id, message });
      if (thr.threadId !== thr.cur.id) thrOpenStream(thr.cur.id);
    } else {
      return;
    }
    thrEl.input.value = '';
  } catch (e) {
    showToast('error', e.message);
  } finally {
    thr.sending = false;
    thrRenderState();
  }
}

export async function deleteThread(id) {
  if (!id) return;
  const t = thr.list.find(x => x.id === id) || (thr.cur?.id === id ? thr.cur : null);
  const title = t?.title ? `"${t.title}"` : 'this thread';
  if (!confirm(`Delete ${title} and its transcript?`)) return;
  try {
    await apiPost('/api/threads/delete', { id });
    if (thr.cur && thr.cur.id === id) thrBack();
  } catch (e) {
    showToast('error', e.message);
  }
}

export function deleteCurrentThread() {
  if (thr.cur) deleteThread(thr.cur.id);
  else showToast('error', 'No thread currently open');
}

export function initThreads() {
  thrEl.listView = $('#thr-list-view');
  thrEl.threadView = $('#thr-thread-view');
  thrEl.list = $('#thr-list');
  thrEl.title = $('#thr-title');
  thrEl.del = $('#thr-delete');
  thrEl.anchor = $('#thr-anchor');
  thrEl.msgs = $('#thr-msgs');
  thrEl.input = $('#thr-input');
  thrEl.send = $('#thr-send');
  thrEl.hint = $('#thr-hint');
  $('#thr-scope')?.addEventListener('click', e => {
    const b = e.target.closest('button[data-scope]');
    if (b && !b.disabled) thrPickScope(b.dataset.scope);
  });
  if (!thrEl.listView) return;

  setThreadHandler(newThread);
  registerAgentPicker($('#thr-agent'));

  $('#thr-new').addEventListener('click', () => newThread(null));
  $('#thr-back').addEventListener('click', thrBack);
  $('#btn-top-threads')?.addEventListener('click', toggleThreadsSidebar);
  $('#btn-close-threads')?.addEventListener('click', hideThreadsSidebar);

  /* Threads sidebar resizer */
  (() => {
    const trz = $('#threads-resizer');
    if (!trz) return;
    let dragging = false;
    trz.addEventListener('mousedown', e => { dragging = true; trz.classList.add('drag'); e.preventDefault(); });
    addEventListener('mousemove', e => {
      if (!dragging) return;
      const w = Math.max(260, Math.min(800, window.innerWidth - e.clientX));
      $('#threads-side').style.width = w + 'px';
    });
    addEventListener('mouseup', () => { if (dragging) { dragging = false; trz.classList.remove('drag'); layout(); render(); } });
  })();
  thrEl.send.addEventListener('click', () => {
    if (!thrRunning()) { thrSend(); return; }
    if (thr.cur) apiPost('/api/threads/cancel', { id: thr.cur.id }).catch(e => showToast('error', e.message));
  });
  thrEl.input.addEventListener('input', thrSyncSend);
  thrEl.del.addEventListener('click', () => {
    if (thr.cur) deleteThread(thr.cur.id);
  });
  thrEl.input.addEventListener('keydown', e => {
    // Typing here must not trigger editor shortcuts, or Esc closing the sidebar.
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); thrSend(); }
    else if (e.key === 'Escape') thrEl.input.blur();
  });
  thrEl.anchor.addEventListener('click', () => {
    const p = thrEl.anchor.dataset.path;
    if (p) openFile(p, { line: +thrEl.anchor.dataset.line || 1 });
  });
  thrEl.msgs.addEventListener('click', e => {
    const cp = /** @type {HTMLElement|null} */ (e.target)?.closest('[data-control~=thr-copy]');
    if (cp) {
      const code = cp.closest('.thr-pre')?.querySelector('code')?.textContent || '';
      if (code) {
        // The button is icon-sized: a tick, not the "✓ Copied" label flash.
        copyToClipboard(code, 'Copied code');
        clearTimeout(cp._copiedTimer);
        cp.classList.add('copied');
        cp.innerHTML = COPIED_ICON;
        cp._copiedTimer = setTimeout(() => {
          cp.classList.remove('copied');
          cp.innerHTML = COPY_ICON;
        }, 1400);
      }
      return;
    }
    const link = /** @type {HTMLElement|null} */ (e.target)?.closest('a.thr-link');
    if (link && link.dataset.path) {
      e.preventDefault();
      thrOpenLink(link);
      return;
    }
    if (/** @type {HTMLElement|null} */ (e.target)?.closest('[data-explain-again]') && thr.cur?.explainReq) {
      thrExplain({ ...thr.cur.explainReq, force: true });
      return;
    }
    const rev = /** @type {HTMLElement|null} */ (e.target)?.closest('[data-revert-turn]');
    if (rev && thr.cur) {
      const turnId = +rev.dataset.revertTurn;
      rev.disabled = true;
      apiPostJson('/api/threads/revert', { id: thr.cur.id, turn: turnId })
        .then(updated => {
          thr.cur = updated;
          thrRenderState();
          reloadWorkspace(null, 'Reverted turn #' + turnId);
          showToast('success', 'Reverted turn #' + turnId, 2500);
        })
        .catch(err => {
          rev.disabled = false;
          showToast('error', 'Revert failed: ' + err.message);
        });
      return;
    }
    const f = /** @type {HTMLElement|null} */ (e.target)?.closest('[data-control~=thr-file]');
    if (f) {
      const turnId = +f.dataset.turnId;
      const turn = thr.cur?.turns?.find(x => x.id === turnId);
      if (turn && turn.beforeSha && turn.afterSha && !turn.reverted) {
        openFile(f.dataset.path, {
          ref: turn.afterSha,
          base: turn.beforeSha,
          turnFiles: turn.changed,
          turnLabel: 'Turn #' + turn.id,
          view: 'diff',
        });
      } else {
        openFile(f.dataset.path);
      }
    }
  });
  const openFromList = e => {
    const delBtn = /** @type {HTMLElement|null} */ (e.target)?.closest('[data-del]');
    if (delBtn) {
      e.stopPropagation();
      e.preventDefault();
      deleteThread(delBtn.dataset.del);
      return;
    }
    const item = /** @type {HTMLElement|null} */ (e.target)?.closest('[data-ui~=thr-item]');
    if (item) openThread(item.dataset.id);
  };
  thrEl.list.addEventListener('click', openFromList);
  thrEl.list.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      openFromList(e);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      const item = /** @type {HTMLElement|null} */ (e.target)?.closest('[data-ui~=thr-item]');
      if (item && item.dataset.id) {
        e.preventDefault();
        deleteThread(item.dataset.id);
      }
    }
  });
  $$('[data-thr-filter]').forEach(b => b.addEventListener('click', () => {
    thr.filter = b.dataset.thrFilter;
    $$('[data-thr-filter]').forEach(x => setPressed(x, x === b));
    thrDrawList();
  }));
  on('tab:activated', () => { if (thr.filter === 'file') thrDrawList(); });
  // agent.js keeps its inline edit comments at the top of this pane and hands off here.
  on('threads:reveal', () => showThreadsSidebar());
  on('threads:open', id => { if (id) openThread(id); });
  on('threads:drafts', n => {
    $$('[data-control~=thr-tab-count]').forEach(c => {
      c.hidden = !n;
      c.textContent = n;
      c.title = n + (n === 1 ? ' comment' : ' comments') + ' waiting to be applied';
    });
  });
  on('threads:shown', () => { if (!thr.cur && !thr.draft) thrShow('list'); thrDrawList(); });

  // Threads exist whenever a harness manager does; -no-agent removes them.
  api('/api/threads').then(j => {
    thr.avail = true;
    setExplainHandler(explainSelection);
    setExplainPrepareHandler(prepareExplain);
    initOrb({
      open: id => {
        if (thr.cur?.id !== id) { openThread(id); return; }
        showThreadsSidebar();
        thrShow('thread');
      },
      showing: id => !document.body.classList.contains('threads-hidden') && !thrEl.threadView.hidden &&
        (id ? thr.cur?.id === id : String(thr.opening).startsWith('explain:')),
    });
    $('#btn-top-threads')?.removeAttribute('hidden');
    thr.list = j.threads || [];
    thrDrawList();
    thrWireStream();
    thrConnectList();
  }).catch(() => {
    $('#btn-top-threads')?.setAttribute('hidden', '');
    $('[data-sel="thread"]')?.setAttribute('hidden', '');
    $('[data-sel="explain"]')?.setAttribute('hidden', '');
  });
}
