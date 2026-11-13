import type { Position } from './cursor.ts';
import { wordAtColumn } from './cursor.ts';

// Each viewport owns the elements used by these DOM-only adapters.
export function createSourceDOM(
  rows: HTMLElement | null | undefined,
  activeDocument: () => { path: string } | null,
) {
  const rowFor = (line: number) => rows?.querySelector(`[data-l="${line}"]`);
  function toPoint(position: Position | null): [Node, number] | null {
    if (!position) return null;
    const { line, col } = position;
    const code = rowFor(line)?.querySelector('.c');
    if (!code) return null;
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    let remaining = col;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!(node instanceof Text)) continue;
      if (remaining <= node.length) return [node, remaining];
      remaining -= node.length;
    }
    return [code, code.childNodes.length];
  }
  function toPos(node: Node | null, offset: number): Position | null {
    if (!node) return null;
    const element = node instanceof Element ? node : node.parentElement;
    const row = element?.closest<HTMLElement>('[data-l], [data-old-l], [data-at]');
    const code = row?.querySelector('.c, .diff-code');
    if (!row || !code) return null;
    const range = document.createRange();
    range.selectNodeContents(code);
    const comparison = range.comparePoint(node, offset);
    if (comparison < 0)
      return { line: +(row.dataset.l || row.dataset.oldL || row.dataset.at || 0), col: 0 };
    if (comparison > 0)
      return {
        line: +(row.dataset.l || row.dataset.oldL || row.dataset.at || 0),
        col: code.textContent.length,
      };
    range.setEnd(node, offset);
    return {
      line: +(row.dataset.l || row.dataset.oldL || row.dataset.at || 0),
      col: range.toString().length,
    };
  }
  function pointAt(x: number, y: number) {
    const point = document.caretPositionFromPoint?.(x, y);
    if (point) return toPos(point.offsetNode, point.offset);
    const range = document.caretRangeFromPoint?.(x, y);
    return range ? toPos(range.startContainer, range.startOffset) : null;
  }
  function wordAtPoint(x: number, y: number) {
    const point = pointAt(x, y);
    if (!point || !activeDocument()) return null;
    const row =
      document.elementFromPoint(x, y)?.closest('[data-l], [data-old-l], [data-at]') ||
      rowFor(point.line);
    const text = row?.querySelector('.c, .diff-code')?.textContent || '';
    const word = wordAtColumn(text, point.col);
    return word
      ? {
          ...word,
          line: point.line,
          path: activeDocument()?.path || '',
          inDiff: !!row?.querySelector('.diff-code'),
        }
      : null;
  }
  return { rowFor, toPoint, toPos, pointAt, wordAtPoint };
}
