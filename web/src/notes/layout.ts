export const GHOST_PADDING_TOP = 8;
export const GHOST_PADDING_BOTTOM = 4;
import { lineText } from '../editor/layout.ts';
export function indentCols(html: string): number {
  let columns = 0;
  for (const char of /^\s*/.exec(lineText(html))?.[0] || '')
    columns += char === '\t' ? 4 - (columns % 4) : 1;
  return columns;
}
export function ghostIndent(
  total: number,
  numbers: boolean,
  charWidth: number,
  html: string,
): number {
  return (numbers ? String(total || 1).length * charWidth + 30 : 0) + indentCols(html) * charWidth;
}
