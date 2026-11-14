export function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function plain(source: string, want: number): string[] {
  const lines = source.split('\n').map(escape);
  while (lines.length < want) lines.push('');
  return lines.slice(0, want);
}
export function visualWidth(text: string): number {
  let width = 0;
  for (const c of text) width += c === '\t' ? 4 - (width % 4) : 1;
  return width;
}
