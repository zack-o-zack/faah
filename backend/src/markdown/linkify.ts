import type MarkdownIt from 'markdown-it';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs';
const protocol =
  /^(?:http|https|ftp):\/\/[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-z]+(?::\d+)?(?:[/#?][-a-zA-Z0-9@:%_+.~#$!?&/=();,'">^{}[\]`]*)?/;
const www =
  /^www\.[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-z]+(?:[/#?][-a-zA-Z0-9@:%_+.~#!?&/=();,'">^{}[\]`]*)?/;
const email =
  /^[A-Za-z0-9][.!#$%&'*+\-/=?^_`{|}~A-Za-z0-9]*@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*/;
const allowedURL = new Set(
  "!#$&'()*+,-./0123456789:;=?@ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~",
);
export function escapeURL(value: string): string {
  let result = '';
  for (let i = 0; i < value.length;) {
    const point = value.codePointAt(i);
    if (point === undefined) break;
    const c = String.fromCodePoint(point);
    if (c === '%' && /^[0-9a-fA-F]{2}/.test(value.slice(i + 1, i + 3))) {
      result += value.slice(i, i + 3);
      i += 3;
      continue;
    }
    result += allowedURL.has(c) ? c : encodeURIComponent(c);
    i += c.length;
  }
  return result;
}
function candidate(text: string): { label: string; href: string } | undefined {
  let raw = protocol.exec(text)?.[0],
    prefix = '';
  if (!raw) {
    raw = www.exec(text)?.[0];
    if (raw) prefix = 'http://';
  }
  if (!raw) {
    raw = email.exec(text)?.[0];
    if (!raw) return;
    if (!raw.slice(raw.indexOf('@') + 1).includes('.') || /^[-_]/.test(text.slice(raw.length)))
      return;
    prefix = 'mailto:';
  }
  let label = raw.replace(/[?!.,:*_~]+$/, '');
  if (label.endsWith(')')) {
    const excess = (label.match(/\)/g)?.length ?? 0) - (label.match(/\(/g)?.length ?? 0);
    if (excess > 0) label = label.slice(0, -excess);
  } else if (label.endsWith(';')) label = label.replace(/&[A-Za-z0-9]+;$/, '');
  return { label, href: prefix + label };
}
function boundary(source: string, pos: number): boolean {
  return pos === 0 || /[ \t\r\n\f*_~(]/.test(source[pos - 1] ?? '');
}
const terminator = /[\n!#$%&*+\-:<=>@[\\\]^_`{}~]/;
// Markdown-it tracks raw <a> tags in linkLevel too. Goldmark only suppresses
// automatic links within Markdown link labels, so subtract raw HTML nesting.
const htmlLevels = new WeakMap<StateInline, { seen: number; html: number }>();
function linkLabel(state: StateInline): boolean {
  const level = 'linkLevel' in state && typeof state.linkLevel === 'number' ? state.linkLevel : 0;
  const cached = htmlLevels.get(state);
  let html = cached && cached.seen <= state.tokens.length ? cached.html : 0;
  for (
    let i = cached && cached.seen <= state.tokens.length ? cached.seen : 0;
    i < state.tokens.length;
    i++
  ) {
    const token = state.tokens[i];
    if (token?.type !== 'html_inline') continue;
    if (/^<a[>\s]/i.test(token.content)) html++;
    if (/^<\/a\s*>/i.test(token.content)) html--;
  }
  htmlLevels.set(state, { seen: state.tokens.length, html });
  return level > html;
}
export function goldmarkLinks(md: MarkdownIt): void {
  md.inline.ruler.disable('linkify');
  md.core.ruler.disable('linkify');
  md.normalizeLink = escapeURL;
  md.normalizeLinkText = (url) => url;
  md.inline.ruler.before('text', 'goldmark_linkify', (state, silent) => {
    if (silent || !boundary(state.src, state.pos) || linkLabel(state)) return false;
    const hit = candidate(state.src.slice(state.pos, state.posMax));
    if (!hit?.label) return false;
    const open = state.push('link_open', 'a', 1);
    open.attrSet('href', escapeURL(hit.href));
    open.markup = 'linkify';
    state.push('text', '', 0).content = hit.label;
    state.push('link_close', 'a', -1).markup = 'linkify';
    state.pos += hit.label.length;
    return true;
  });
  md.inline.ruler.at('text', (state, silent) => {
    const start = state.pos;
    let pos = start;
    while (pos < state.posMax && !terminator.test(state.src[pos] ?? '')) {
      if (pos > start && boundary(state.src, pos) && candidate(state.src.slice(pos, state.posMax)))
        break;
      pos++;
    }
    if (pos === start) return false;
    if (!silent) state.pending += state.src.slice(start, pos);
    state.pos = pos;
    return true;
  });
}
