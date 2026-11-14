// This is deliberately independent of the backend's scope mapper: changing the
// renderer must not silently expand the accepted contract vocabulary.
const vocabulary = new Set([
  'kt',
  'na',
  'nt',
  'nd',
  'nc',
  'no',
  'np',
  'err',
  'gi',
  'gd',
  'gh',
  'ge',
  'gs',
  'k',
  'nf',
  'nv',
  'nb',
  's',
  'm',
  'o',
  'p',
  'cp',
  'c',
  'g',
]);
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function highlightedText(html: string): string {
  const stack: string[] = [];
  let text = '',
    start = 0;
  for (const match of html.matchAll(/<[^>]*>/g)) {
    text += html.slice(start, match.index);
    start = match.index + match[0].length;
    const opening = /^<(i|span) class=(?:"([a-z]+)"|([a-z]+))>$/.exec(match[0]);
    if (opening) {
      const tag = opening[1],
        cls = opening[2] ?? opening[3];
      if (!tag || !cls || !vocabulary.has(cls))
        throw new Error('unknown highlight class: ' + match[0]);
      stack.push(tag);
    } else {
      const close = /^<\/(i|span)>$/.exec(match[0]);
      if (!close || stack.pop() !== close[1])
        throw new Error('malformed highlighted HTML: ' + match[0]);
    }
  }
  if (stack.length) throw new Error('unclosed highlighted HTML');
  text += html.slice(start);
  if (text.includes('<') || text.includes('>')) throw new Error('unescaped highlighted text');
  return text;
}
export function markdownHighlights(html: string): string {
  return html.replace(
    /(<pre class="md-code"[^>]*><code>)([\s\S]*?)(<\/code><\/pre>)/g,
    (_, open: string, code: string, close: string) => open + highlightedText(code) + close,
  );
}
export function comparableHighlight(value: unknown, route: string): unknown {
  if (!object(value)) return value;
  const name = route.split('?')[0];
  if (name !== 'api/file' && name !== 'api/markdown') return value;
  const body = object(value.body) ? value.body : undefined;
  if (!body || (typeof value.status === 'number' && value.status !== 200)) return value;
  const copy = { ...body };
  if (name === 'api/file' && Array.isArray(body.lines))
    copy.lines = body.lines.map((line: unknown) => {
      if (typeof line !== 'string') throw new Error('invalid highlighted line');
      return highlightedText(line);
    });
  if (name === 'api/markdown' && typeof body.html === 'string')
    copy.html = markdownHighlights(body.html);
  return { ...value, body: copy };
}
