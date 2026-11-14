export function escape(text: string): string {
  return /[&<>]/.test(text)
    ? text.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
    : text;
}
export function plain(source: string, want: number): string[] {
  const lines = source.split('\n').map(escape);
  while (lines.length < want) lines.push('');
  return lines.slice(0, want);
}
export function visualWidth(text: string, initial = 0): number {
  let width = initial;
  for (const c of text) width += c === '\t' ? 4 - (width % 4) : 1;
  return width;
}
