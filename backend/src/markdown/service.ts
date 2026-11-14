import { goldmarkStrike } from './strike.ts';
import { goldmarkLinks } from './linkify.ts';
import MarkdownIt from 'markdown-it';
import footnotes from 'markdown-it-footnote';
import tasks from 'markdown-it-task-lists';
import type Token from 'markdown-it/lib/token.mjs';
import { headingID, fenceLanguage } from '../render/language.ts';
import { escape } from '../render/html.ts';
import type { Highlight } from '../render/document.ts';
import { record, number } from '../decode.ts';
export function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}
function attr(text: string): string {
  return escape(text).replace(/"/g, '&#34;').replace(/'/g, '&#39;');
}
const markerTypes = new Set([
  'heading_open',
  'paragraph_open',
  'bullet_list_open',
  'ordered_list_open',
  'list_item_open',
  'blockquote_open',
  'table_open',
  'fence',
  'code_block',
]);
function firstLine(tokens: Token[], index: number): number | undefined {
  const token = tokens[index];
  if (!token) return;
  if (
    ['bullet_list_open', 'ordered_list_open', 'list_item_open', 'blockquote_open'].includes(
      token.type,
    )
  ) {
    const child = tokens[index + 1];
    if (child && child.level > token.level && child.type !== 'hr')
      return firstLine(tokens, index + 1);
    return;
  }
  if (!token.map) return;
  if (token.type === 'fence') return token.content ? token.map[0] + 2 : undefined;
  return token.map[0] + 1;
}
function footID(token: Token | undefined): { id: number; sub: number } {
  const meta = record(token?.meta);
  return { id: number(meta.id) + 1, sub: typeof meta.subId === 'number' ? meta.subId : 0 };
}
export async function renderMarkdown(input: string, highlight: Highlight): Promise<string> {
  const source = input.replaceAll('\r\n', '\n');
  const md = new MarkdownIt({ html: true, linkify: true, breaks: false, typographer: false })
    .use(footnotes)
    .use(tasks, { enabled: false, label: false })
    .use(goldmarkLinks)
    .use(goldmarkStrike);
  // Goldmark accepts raw HTML and unsafe link destinations; browser sanitizing
  // remains the existing boundary. markdown-it's default URL policy is stricter.
  md.validateLink = () => true;
  const tokens = md.parse(source, {}),
    seen = new Set<string>();
  const rendered = new Map<Token, string>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;
    if (token.type === 'heading_open') {
      token.attrSet('id', headingID(tokens[i + 1]?.content.split('\n').at(-1) ?? '', seen));
    }
    if (markerTypes.has(token.type)) {
      const line = firstLine(tokens, i);
      if (line !== undefined) token.attrSet('data-line', String(line));
    }
    if (token.attrs)
      token.attrs = token.attrs.filter(
        ([name]) =>
          name !== 'class' ||
          !['task-list-item', 'contains-task-list'].some((c) =>
            token.attrGet('class')?.includes(c),
          ),
      );
    if (token.children)
      for (const child of token.children)
        if (
          child.type === 'html_inline' &&
          child.content.startsWith('<input class="task-list-item-checkbox"')
        )
          child.content = child.content.replace(' class="task-list-item-checkbox"', '');
  }
  await Promise.all(
    tokens
      .filter((t) => t.type === 'fence' || t.type === 'code_block')
      .map(async (token) => {
        const lang = token.type === 'fence' ? (token.info.trim().split(/\s+/)[0] ?? '') : '';
        const code = token.content.replace(/\n$/, ''),
          grammar = lang && Buffer.byteLength(code) <= 256 << 10 ? fenceLanguage(lang) : undefined;
        const html = grammar
          ? (await highlight(code, grammar, code.split('\n').length)).join('\n')
          : escape(code);
        const line = token.attrGet('data-line');
        rendered.set(
          token,
          `<pre class="md-code"${line ? ` data-line="${line}"` : ''}${lang ? ` data-lang="${attr(lang)}"` : ''}><code>${html}</code></pre>\n`,
        );
      }),
  );
  md.renderer.rules.s_open = () => '<del>';
  md.renderer.rules.s_close = () => '</del>';
  md.renderer.rules.blockquote_open = (ts, i) => {
    const token = ts[i];
    return token
      ? '<blockquote' + md.renderer.renderAttrs(token) + '>' + (token.attrs?.length ? '' : '\n')
      : '';
  };
  const fence = (ts: Token[], i: number) => {
    const token = ts[i];
    return token ? (rendered.get(token) ?? '') : '';
  };
  md.renderer.rules.fence = fence;
  md.renderer.rules.code_block = fence;
  md.renderer.rules.footnote_ref = (ts, i) => {
    const { id, sub } = footID(ts[i]);
    const ref = sub > 0 ? `${sub}:${id}` : `:${id}`;
    return `<sup id="fnref${ref}"><a href="#fn:${id}" class="footnote-ref" role="doc-noteref">${id}</a></sup>`;
  };
  md.renderer.rules.footnote_block_open = () =>
    '<div class="footnotes" role="doc-endnotes">\n<hr>\n<ol>\n';
  md.renderer.rules.footnote_block_close = () => '</ol>\n</div>\n';
  md.renderer.rules.footnote_open = (ts, i) => `<li id="fn:${footID(ts[i]).id}">\n`;
  md.renderer.rules.footnote_close = () => '</li>\n';
  md.renderer.rules.footnote_anchor = (ts, i) => {
    const { id, sub } = footID(ts[i]),
      ref = sub > 0 ? `${sub}:${id}` : `:${id}`;
    return `&#160;<a href="#fnref${ref}" class="footnote-backref" role="doc-backlink">&#x21a9;&#xfe0e;</a>`;
  };
  return md.renderer.render(tokens, md.options, {});
}
