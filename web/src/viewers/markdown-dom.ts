function queryable(node: Node): ParentNode | null {
  return node instanceof Element || node instanceof DocumentFragment ? node : null;
}
import { normalizeURL } from './markdown-logic.ts';
import { pictureSource } from './markdown-picture.ts';
const HTML_NS = 'http://www.w3.org/1999/xhtml';
// Removed along with everything inside them.
const MD_DROP = new Set(
  (
    'script style iframe frame frameset object embed applet template noscript noembed ' +
    'svg math form textarea select option button link meta base title audio video track canvas dialog'
  ).split(' '),
);
// Kept. Any other element is unwrapped: its children stay, the element goes.
const MD_KEEP = new Set(
  (
    'a abbr b bdi bdo blockquote br caption center cite code col colgroup dd del details dfn div dl dt ' +
    'em figcaption figure h1 h2 h3 h4 h5 h6 hr i img input ins kbd li mark ol p pre q rp rt ruby s samp section small span ' +
    'picture source strike strong sub summary sup table tbody td tfoot th thead tr tt u ul var wbr'
  ).split(' '),
);
// Attributes that can neither run script nor reach the network.
const MD_ATTRS = new Set(
  (
    'align valign alt title lang dir width height colspan rowspan start reversed open checked ' +
    'disabled type data-line data-lang'
  ).split(' '),
);
// Token classes from the server's highlighter, allowed on <i>.
const MD_TOKENS = new Set(
  'k kt nf nc nb nv no na nt nd np s m o p c cp gi gd gh ge gs err g'.split(' '),
);
const MD_SCHEME = /^([a-z][a-z0-9+.-]*):/i;
// Relative references resolve against this stand-in origin; landing anywhere else means they were not relative.
const MD_ORIGIN = 'http://faah.invalid';

/* The URL parser drops tabs and newlines anywhere and control characters at
   either end, so "java&#9;script:" still has a scheme. Test what it will see. */
const mdURL = normalizeURL;

/* Parsing into a DOMParser document runs no script and loads nothing, so the
   markup can be cleaned there and only the survivors adopted into the page. */
function sanitizeBody(html: string, docPath: string): HTMLElement {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const dir = docPath.slice(0, docPath.lastIndexOf('/') + 1);
  const base = MD_ORIGIN + '/' + dir.split('/').map(encodeURIComponent).join('/');
  for (const el of body.querySelectorAll<HTMLElement>('*')) {
    if (!body.contains(el)) continue; // inside something already removed
    const tag = el.localName;
    if (el.namespaceURI !== HTML_NS || MD_DROP.has(tag)) {
      el.remove();
      continue;
    }
    if (!MD_KEEP.has(tag) || (tag === 'input' && el.getAttribute('type') !== 'checkbox')) {
      el.replaceWith(...el.childNodes);
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of [...el.attributes]) {
      attrs[a.name] = a.value;
      el.removeAttribute(a.name);
    }
    for (const name in attrs) if (MD_ATTRS.has(name)) el.setAttribute(name, attrs[name] ?? '');
    // Prefixed so a heading called "status" cannot shadow the status bar's id.
    const id = attrs.id || (tag === 'a' && attrs.name);
    if (id) el.id = 'md-' + id;
    if (attrs.class) {
      const keep = attrs.class
        .split(/\s+/)
        .filter(
          (c) => c === 'md-code' || c.startsWith('footnote') || (tag === 'i' && MD_TOKENS.has(c)),
        );
      if (keep.length) el.className = keep.join(' ');
    }
    if (tag === 'input') el.className = 'input mr-2';
    if (tag === 'kbd') el.className = 'kbd';
    if (el instanceof HTMLInputElement) el.disabled = true;
    if (tag === 'source') {
      const candidate =
        el.parentElement?.localName === 'picture' &&
        pictureSource(attrs.srcset || '', attrs.media || '');
      if (!candidate) {
        el.remove();
        continue;
      }
      const image = document.createElement('img');
      mdSetImage(image, candidate.src, base);
      if (!image.hasAttribute('src')) {
        el.remove();
        continue;
      }
      el.setAttribute('srcset', image.getAttribute('src') || '');
      el.dataset.mdScheme = candidate.scheme;
      el.dataset.origSrc = candidate.src;
      if (image.dataset.rawPath) el.dataset.rawPath = image.dataset.rawPath;
    }
    if (tag === 'img') mdSetImage(el, mdURL(attrs.src || ''), base);
    if (tag === 'a' && attrs.href) mdSetLink(el, mdURL(attrs.href), base);
  }
  return body;
}
export function sanitizeHTML(html: string, path: string): string {
  return sanitizeBody(html, path).innerHTML;
}
export function sanitizeDocument(html: string, path: string): DocumentFragment {
  const body = sanitizeBody(html, path);
  const frag = document.createDocumentFragment();
  while (body.firstChild) frag.appendChild(document.adoptNode(body.firstChild));

  return frag;
}

// Server-rendered Markdown from anywhere but a workspace file (a PR comment),
// cleaned the same way as the preview.
export function sanitizeMarkdown(html: string): DocumentFragment {
  return sanitizeDocument(html, '');
}

/* Native media queries follow the OS; pictures in the preview follow the app theme. */
export function syncMarkdownPictures(root: ParentNode, scheme: string): void {
  for (const picture of root.querySelectorAll('picture')) {
    const sources = [...picture.querySelectorAll<HTMLElement>('source[data-md-scheme]')];
    const selected = sources.find((source) => source.dataset.mdScheme === scheme);
    const img = picture.querySelector('img');
    if (img)
      img.dataset.picturePath = selected
        ? selected.dataset.rawPath || ''
        : img.dataset.rawPath || '';
    for (const source of sources) {
      source.setAttribute(
        'media',
        source.dataset.mdScheme === scheme ? '(min-width: 0px)' : 'not all',
      );
    }
  }
}

/* A reference without a scheme names a file in the workspace, relative to the
   Markdown file's directory, or to the root when it starts with /, as on GitHub.
   Returns null for anything that does not resolve that way. */
function mdLocal(ref: string, base: string): { path: string; hash: string } | null {
  let u;
  try {
    u = new URL(ref, base);
  } catch {
    return null;
  }
  if (u.origin !== MD_ORIGIN) return null;
  let path = u.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    /* Preserve percent escapes that cannot be decoded. */
  }
  return { path: path.slice(1), hash: u.hash.slice(1) };
}

function mdSetImage(img: HTMLElement, src: string, base: string): void {
  img.setAttribute('loading', 'lazy');
  img.setAttribute('decoding', 'async');
  img.classList.add('md-zoomable');
  const m = MD_SCHEME.exec(src);
  if (m) {
    if (/^https?$/i.test(m[1] || '') || /^data:image\//i.test(src)) {
      img.setAttribute('src', src);
      img.dataset.origSrc = src;
    }
  } else if (src.startsWith('//')) {
    img.setAttribute('src', src);
    img.dataset.origSrc = src;
  } else if (src) {
    const t = mdLocal(src, base);
    if (t) {
      const rawUrl = new URL(
        'api/raw?path=' + encodeURIComponent(t.path),
        document.baseURI || location.href,
      ).href;
      img.setAttribute('src', rawUrl);
      img.dataset.rawPath = t.path;
      img.dataset.origSrc = src;
    }
  }
}

/* Links within the file scroll the preview, links to workspace files open them
   in faah, web links open a new browser tab, and any other scheme loses its href. */
function mdSetLink(a: HTMLElement, href: string, base: string): void {
  if (href.startsWith('#')) {
    a.setAttribute('href', href);
    a.dataset.anchor = href.slice(1);
    return;
  }
  const m = MD_SCHEME.exec(href);
  if (m || href.startsWith('//')) {
    if (m && !/^(https?|mailto)$/i.test(m[1] || '')) return;
    a.setAttribute('href', href);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
    return;
  }
  const t = mdLocal(href, base);
  if (!t) return;
  const rawUrl = new URL(
    'api/raw?path=' + encodeURIComponent(t.path),
    document.baseURI || location.href,
  ).href;
  a.setAttribute('href', rawUrl);
  a.dataset.path = t.path;
  if (t.hash) a.dataset.anchor = t.hash;
}

/* ---------- presentation ---------- */

const MD_ALERTS: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};
const MD_ALERT_CLASSES: Record<string, string> = {
  note: 'md-alert-note',
  tip: 'md-alert-tip',
  important: 'md-alert-important',
  warning: 'md-alert-warning',
  caution: 'md-alert-caution',
};

export function enhanceMarkdown(mdArticle: HTMLElement): void {
  for (const q of mdArticle.querySelectorAll('blockquote')) mdAlert(q);
  for (const pre of mdArticle.querySelectorAll('pre')) {
    const wrap = document.createElement('div');
    wrap.className = 'md-pre';
    if (pre.dataset.lang) wrap.dataset.lang = pre.dataset.lang;
    pre.replaceWith(wrap);
    const copy = document.createElement('button');
    copy.className = 'btn';
    copy.dataset.control = 'md-copy';
    copy.dataset.variant = 'ghost';
    copy.dataset.size = 'icon-xs';
    copy.title = 'Copy code';
    copy.setAttribute('aria-label', 'Copy code');
    // An icon, not a label: find in the preview walks text nodes.
    const icon = document.createElement('span');
    icon.className = 'icon-[lucide--copy] size-3.5 shrink-0';
    icon.setAttribute('aria-hidden', 'true');
    copy.append(icon);
    const toolbar = document.createElement('div');
    toolbar.className =
      'flex items-center justify-between gap-2 border border-b-0 rounded-t-md bg-sidebar px-3 py-1 text-xs text-muted-foreground';
    const language = document.createElement('span');
    language.textContent = pre.dataset.lang || 'Code';
    toolbar.append(language, copy);
    wrap.append(toolbar, pre);
  }
}

/* GitHub alerts: a blockquote opening with [!NOTE], [!TIP], [!IMPORTANT],
   [!WARNING] or [!CAUTION]. */
function mdAlert(q: HTMLElement): void {
  const p = q.firstElementChild;
  const t = p && p.localName === 'p' && p.firstChild;
  if (!t || !(t instanceof Text) || !p) return;
  const m = /^\s*\[!(\w+)\][ \t]*\n?/.exec(t.nodeValue || '');
  const kind = m?.[1]?.toLowerCase();
  if (!m || !kind || !MD_ALERTS[kind]) return;
  t.nodeValue = (t.nodeValue || '').slice(m[0].length);
  if (!t.nodeValue) t.remove();
  if (p.firstChild && (p.firstChild instanceof Element && p.firstChild.localName) === 'br')
    p.firstChild.remove();
  if (!(p.textContent || '').trim() && !p.children.length) p.remove();
  const title = document.createElement('p');
  title.className = 'md-alert-title';
  title.textContent = MD_ALERTS[kind];
  q.prepend(title);
  q.classList.add('md-alert', MD_ALERT_CLASSES[kind] || '');
}

export function getFragmentPlainText(frag: Node): string {
  const clone = frag.cloneNode(true);
  for (const wrap of queryable(clone)?.querySelectorAll<HTMLElement>('.md-pre.md-mermaid-ready') ||
    []) {
    const source = wrap.querySelector('pre');
    const diagram = wrap.querySelector('.md-mermaid');
    if (source && diagram) diagram.replaceWith(document.createTextNode(source.textContent || ''));
  }
  const bad = queryable(clone)?.querySelectorAll<HTMLElement>(
    '[data-control~=md-copy], [data-control~=line-btn], [hidden], svg, style, script',
  );
  if (bad) {
    for (const b of bad) b.remove();
  }
  return (clone.textContent || '').replace(/\r\n/g, '\n');
}

export function getFragmentHtml(frag: Node): string {
  const clone = frag.cloneNode(true);
  for (const wrap of queryable(clone)?.querySelectorAll<HTMLElement>('.md-pre.md-mermaid-ready') ||
    []) {
    const source = wrap.querySelector('pre');
    const diagram = wrap.querySelector('.md-mermaid');
    if (source && diagram) {
      source.hidden = false;
      diagram.remove();
    }
  }
  const bad = queryable(clone)?.querySelectorAll<HTMLElement>(
    '[data-control~=md-copy], [data-control~=line-btn], [hidden]',
  );
  if (bad) {
    for (const b of bad) b.remove();
  }
  const div = document.createElement('div');
  div.appendChild(clone);
  return div.innerHTML;
}

export function getMarkdownRangeLines(
  range: Range,
  mdArticle: HTMLElement,
): { l1: number; l2: number } {
  let l1 = 0,
    l2 = 0;
  const blocks = mdArticle.querySelectorAll<HTMLElement>('[data-line]');
  for (const b of blocks) {
    if (range.intersectsNode(b)) {
      const line = Number(b.dataset.line);
      if (!l1 || line < l1) l1 = line;
      if (line > l2) l2 = line;
    }
  }
  return { l1: l1 || 1, l2: l2 || l1 || 1 };
}

export function domToMarkdown(node: Node | null): string {
  if (!node) return '';
  if (node.nodeType === 3) return node.nodeValue || '';
  if (node instanceof DocumentFragment) return innerDomToMarkdown(node);
  if (!(node instanceof HTMLElement)) return '';

  if (
    node.matches &&
    (node.matches('[data-control~=md-copy], [data-control~=line-btn], [hidden], svg') ||
      node.classList?.contains('md-copy'))
  ) {
    return '';
  }

  const tag = node.nodeType === 1 ? node.tagName.toLowerCase() : '';

  if (tag === 'div' && node.classList.contains('md-pre')) {
    const pre = node.querySelector('pre') || node;
    const lang = node.dataset.lang || pre.dataset.lang || '';
    const code = (node.querySelector('code') || pre).textContent || '';
    return '\n```' + lang + '\n' + code.replace(/\r\n/g, '\n').trimEnd() + '\n```\n\n';
  }

  if (tag === 'pre') {
    const lang = node.dataset.lang || node.closest<HTMLElement>('.md-pre')?.dataset.lang || '';
    const code = (node.querySelector('code') || node).textContent || '';
    return '\n```' + lang + '\n' + code.replace(/\r\n/g, '\n').trimEnd() + '\n```\n\n';
  }

  if (/^h[1-6]$/.test(tag)) {
    const level = parseInt(tag[1] || '1', 10);
    const hashes = '#'.repeat(level);
    return '\n' + hashes + ' ' + innerDomToMarkdown(node).trim() + '\n\n';
  }

  if (tag === 'blockquote') {
    let alertType = '';
    for (const c of (node.className || '').split(/\s+/)) {
      if (c.startsWith('md-alert-')) {
        alertType = c.slice('md-alert-'.length).toUpperCase();
        break;
      }
    }
    let body = innerDomToMarkdown(node).trim();
    if (alertType) body = `[!${alertType}]\n` + body;
    const lines = body
      .split('\n')
      .map((l) => '> ' + l)
      .join('\n');
    return '\n' + lines + '\n\n';
  }

  if (tag === 'p') {
    if (node.classList.contains('md-alert-title')) return '';
    return innerDomToMarkdown(node).trim() + '\n\n';
  }

  if (tag === 'ul' || tag === 'ol') {
    let idx = 1;
    let out = '\n';
    for (const child of node.children) {
      if (child.tagName.toLowerCase() === 'li') {
        const prefix = tag === 'ol' ? `${idx++}. ` : '- ';
        let item = innerDomToMarkdown(child).trim();
        item = item
          .split('\n')
          .map((l, i) => (i === 0 ? l : '  ' + l))
          .join('\n');
        out += prefix + item + '\n';
      }
    }
    return out + '\n';
  }

  if (tag === 'li') {
    let check = '';
    const cb = node.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (cb) check = cb.checked ? '[x] ' : '[ ] ';
    return check + innerDomToMarkdown(node).trim();
  }

  if (tag === 'table') {
    const trs = [...node.querySelectorAll('tr')];
    if (!trs.length) return '';
    let out = '\n';
    let isHeader = true;
    for (const tr of trs) {
      const cells = [...tr.children].filter((c) => /^t[hd]$/i.test(c.tagName));
      if (!cells.length) continue;
      const row =
        '| ' +
        cells
          .map((c) => innerDomToMarkdown(c).trim().replace(/\|/g, '\\|').replace(/\n+/g, ' '))
          .join(' | ') +
        ' |';
      out += row + '\n';
      if (isHeader && tr.querySelector('th')) {
        out += '| ' + cells.map(() => '---').join(' | ') + ' |\n';
        isHeader = false;
      }
    }
    return out + '\n';
  }

  if (tag === 'strong' || tag === 'b') {
    const txt = innerDomToMarkdown(node);
    return txt ? '**' + txt + '**' : '';
  }
  if (tag === 'em' || tag === 'i') {
    if (node.closest('pre, code')) return node.textContent || '';
    const txt = innerDomToMarkdown(node);
    return txt ? '*' + txt + '*' : '';
  }
  if (tag === 'del' || tag === 's' || tag === 'strike') {
    const txt = innerDomToMarkdown(node);
    return txt ? '~~' + txt + '~~' : '';
  }
  if (tag === 'code') {
    if (node.closest('pre')) return node.textContent || '';
    return '`' + node.textContent + '`';
  }
  if (tag === 'a') {
    const href = node.dataset.rawPath || node.dataset.path || node.getAttribute('href') || '';
    const txt = innerDomToMarkdown(node).trim() || href;
    return '[' + txt + '](' + href + ')';
  }
  if (tag === 'img') {
    const src = node.dataset.rawPath || node.dataset.origSrc || node.getAttribute('src') || '';
    const alt = node.getAttribute('alt') || '';
    return '![' + alt + '](' + src + ')';
  }
  if (tag === 'hr') return '\n---\n\n';
  if (tag === 'br') return '\n';
  if (tag === 'input' && node.getAttribute('type') === 'checkbox') {
    return node instanceof HTMLInputElement && node.checked ? '[x] ' : '[ ] ';
  }

  return innerDomToMarkdown(node);
}

function innerDomToMarkdown(node: Node): string {
  let s = '';
  for (const c of node.childNodes) {
    s += domToMarkdown(c);
  }
  return s;
}

/** Stands in for a Markdown image that failed to load, naming what was missing. */
export function brokenImageCard(img: HTMLElement): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'md-img-broken';
  const icon = document.createElement('span');
  icon.className = 'icon-[lucide--image-off] size-4 shrink-0';
  icon.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  const path = img.dataset.rawPath || img.dataset.origSrc || img.getAttribute('src') || 'image';
  text.textContent = 'Image not found: ' + path;
  card.append(icon, text);
  return card;
}
