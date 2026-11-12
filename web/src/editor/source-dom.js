import { wordAtColumn } from './cursor.js';

// Each viewport owns the elements used by these DOM-only adapters.
export function createSourceDOM(rows, activeDocument) {
  const rowFor = (line) => rows?.querySelector(`[data-l="${line}"]`);
  function toPoint(position) {
    if (!position) return null;
    const { line, col } = position;
    const code = rowFor(line)?.querySelector('.c');
    if (!code) return null;
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    let remaining = col;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (remaining <= node.length) return [node, remaining];
      remaining -= node.length;
    }
    return [code, code.childNodes.length];
  }
  function toPos(node, offset) {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    const row = element?.closest('[data-l], [data-old-l], [data-at]');
    const code = row?.querySelector('.c, .diff-code');
    if (!code) return null;
    const range = document.createRange();
    range.selectNodeContents(code);
    const comparison = range.comparePoint(node, offset);
    if (comparison < 0)
      return { line: +(row.dataset.l || row.dataset.oldL || row.dataset.at), col: 0 };
    if (comparison > 0)
      return {
        line: +(row.dataset.l || row.dataset.oldL || row.dataset.at),
        col: code.textContent.length,
      };
    range.setEnd(node, offset);
    return {
      line: +(row.dataset.l || row.dataset.oldL || row.dataset.at),
      col: range.toString().length,
    };
  }
  function pointAt(x, y) {
    const point = document.caretPositionFromPoint?.(x, y);
    if (point) return toPos(point.offsetNode, point.offset);
    const range = document.caretRangeFromPoint?.(x, y);
    return range ? toPos(range.startContainer, range.startOffset) : null;
  }
  function wordAtPoint(x, y) {
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
          path: activeDocument().path,
          inDiff: !!row?.querySelector('.diff-code'),
        }
      : null;
  }
  return { rowFor, toPoint, toPos, pointAt, wordAtPoint };
}
