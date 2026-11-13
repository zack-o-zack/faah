// Markdown contains nested inline and block nodes; recursive interfaces mirror that syntax.
export interface InlineNode {
  type: 'text' | 'code' | 'image' | 'link' | 'strong' | 'del' | 'em';
  text?: string;
  url?: string;
  children?: InlineNode[];
}
export interface MarkdownBlock {
  type: 'code' | 'heading' | 'hr' | 'quote' | 'list' | 'table' | 'paragraph';
  source?: string;
  lang?: string;
  text?: string;
  level?: number;
  alert?: string;
  blocks?: MarkdownBlock[];
  items?: { checked: boolean | null; blocks: MarkdownBlock[] }[];
  ordered?: boolean;
  header?: string[];
  align?: string[];
  rows?: string[][];
}
/** Parse text into inert nodes. JSX owns escaping; raw HTML is always plain text. */
export function safeMarkdownURL(value: string): string {
  const url = value.trim();
  if (/^(https?:|mailto:)/i.test(url)) return url;
  if (/^[a-z][a-z\d+.-]*:/i.test(url) && !/^[\w./-]+:\d+(?:-\d+)?$/.test(url)) return '';
  return /^[\w./#?&=%:@+~-]+$/.test(url) ? url : '';
}
export function citation(value: string): { path: string; line: number; end: number } | null {
  const match = /^([\w./-]+\.[\w]+)(?::(\d+)(?:-(\d+))?)?$/.exec(value);
  return match ? { path: match[1] || '', line: +(match[2] || 0), end: +(match[3] || 0) } : null;
}
export function inlineMarkdown(text: string, depth = 0): InlineNode[] {
  if (depth > 10) return [{ type: 'text', text }];
  const result: InlineNode[] = [];
  const pattern =
    /(`+)([^`]+)\1|!\[([^\]]*)\]\(([^\s)]+)\)|\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*\n]+)\*|_([^_\n]+)_|\bhttps?:\/\/[^\s<>]+|[\w./-]+\.[\w]+:\d+(?:-\d+)?/g;
  let start = 0,
    match;
  while ((match = pattern.exec(text))) {
    if (match.index > start) result.push({ type: 'text', text: text.slice(start, match.index) });
    const raw = match[0] || '';
    if (match[1] || '') result.push({ type: 'code', text: match[2] || '' });
    else if (match[3] !== undefined)
      result.push({ type: 'image', text: match[3] || '', url: safeMarkdownURL(match[4] || '') });
    else if (match[5] !== undefined)
      result.push({
        type: 'link',
        url: safeMarkdownURL(match[6] || ''),
        children: inlineMarkdown(match[5] || '', depth + 1),
      });
    else if (match[7] || match[8] || '')
      result.push({
        type: 'strong',
        children: inlineMarkdown(match[7] || match[8] || '', depth + 1),
      });
    else if (match[9] || '')
      result.push({ type: 'del', children: inlineMarkdown(match[9] || '', depth + 1) });
    else if (match[10] || match[11] || '')
      result.push({
        type: 'em',
        children: inlineMarkdown(match[10] || match[11] || '', depth + 1),
      });
    else
      result.push({
        type: 'link',
        url: safeMarkdownURL(raw),
        children: [{ type: 'text', text: raw }],
      });
    start = pattern.lastIndex;
  }
  if (start < text.length) result.push({ type: 'text', text: text.slice(start) });
  return result;
}
const rowCells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
const tableDivider = (line: string | undefined): boolean =>
  /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line || '');
const blockStart = (line: string): boolean =>
  /^(?:\s*$|#{1,6}\s|\s*[`~]{3,}|\s*>|\s*(?:[-+*]|\d+[.)])\s|\s*(?:---+|\*\*\*+|___+)\s*$)/.test(
    line,
  );
export function markdownBlocks(
  source: string,
  previous: MarkdownBlock[] = [],
  depth = 0,
): MarkdownBlock[] {
  const lines = (source || '').replace(/\r\n?/g, '\n').split('\n'),
    blocks: MarkdownBlock[] = [];
  let at = 0;
  while (at < lines.length) {
    if (!(lines[at] || '').trim()) {
      at++;
      continue;
    }
    const start = at,
      line = lines[at] || '';
    let block: MarkdownBlock;
    const fence = /^\s*(`{3,}|~{3,})([\w+#.-]*)/.exec(line);
    const heading = /^(#{1,6})\s+(.*)/.exec(line);
    const list = /^( *)([-+*]|\d+[.)])\s+(.*)/.exec(line);
    if (fence) {
      at++;
      const code = [];
      while (at < lines.length && !(lines[at] || '').trim().startsWith(fence[1] || ''))
        code.push(lines[at++] || '');
      if (at < lines.length) at++;
      block = { type: 'code', lang: fence[2] || '', text: code.join('\n') };
    } else if (heading) {
      at++;
      block = { type: 'heading', level: (heading[1] || '').length, text: heading[2] || '' };
    } else if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      at++;
      block = { type: 'hr' };
    } else if (/^\s*>/.test(line) && depth < 10) {
      const quoted = [];
      while (at < lines.length && /^\s*>/.test(lines[at] || ''))
        quoted.push((lines[at++] || '').replace(/^\s*> ?/, ''));
      const alert = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i.exec(quoted[0] || '');
      if (alert) quoted.shift();
      block = {
        type: 'quote',
        alert: alert?.[1],
        blocks: markdownBlocks(quoted.join('\n'), [], depth + 1),
      };
    } else if (list && depth < 10) {
      const items = [],
        indent = (list[1] || '').length,
        ordered = /^\d/.test(list[2] || '');
      while (at < lines.length) {
        const item = /^( *)([-+*]|\d+[.)])\s+(.*)/.exec(lines[at] || '');
        if (!item || (item[1] || '').length !== indent || /^\d/.test(item[2] || '') !== ordered)
          break;
        const task = /^\[([ xX])\]\s+(.*)/.exec(item[3] || '');
        const body = [task ? task[2] || '' : item[3] || ''];
        at++;
        while (
          at < lines.length &&
          (lines[at] || '').trim() &&
          (/^ +/.exec(lines[at] || '')?.[0]?.length || 0) > indent
        )
          body.push((lines[at++] || '').slice(indent + 2));
        items.push({
          checked: task ? (task[1] || '').toLowerCase() === 'x' : null,
          blocks: markdownBlocks(body.join('\n'), [], depth + 1),
        });
      }
      block = { type: 'list', ordered, items };
    } else if (line.includes('|') && tableDivider(lines[at + 1] || '')) {
      const header = rowCells(line),
        align = rowCells(lines[at + 1] || '').map((cell) => {
          if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
          return cell.endsWith(':') ? 'right' : 'left';
        });
      at += 2;
      const rows = [];
      while (at < lines.length && (lines[at] || '').trim() && (lines[at] || '').includes('|'))
        rows.push(rowCells(lines[at++] || ''));
      block = { type: 'table', header, align, rows };
    } else {
      const text = [lines[at++] || ''];
      while (
        at < lines.length &&
        !blockStart(lines[at] || '') &&
        !tableDivider(lines[at + 1] || '')
      )
        text.push(lines[at++] || '');
      block = { type: 'paragraph', text: text.join('\n') };
    }
    block.source = lines.slice(start, at).join('\n');
    const prior = previous[blocks.length];
    blocks.push(prior?.source === block.source && prior.type === block.type ? prior : block);
  }
  return blocks;
}
