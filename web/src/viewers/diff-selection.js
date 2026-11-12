function clippedText(element, range) {
  const clipped = document.createRange();
  clipped.selectNodeContents(element);
  if (range.compareBoundaryPoints(Range.START_TO_START, clipped) > 0)
    clipped.setStart(range.startContainer, range.startOffset);
  if (range.compareBoundaryPoints(Range.END_TO_END, clipped) < 0)
    clipped.setEnd(range.endContainer, range.endOffset);
  return clipped.toString();
}
export function diffSelection(root, range, document) {
  if (!root.contains(range.commonAncestorContainer)) return null;
  const lines = [];
  const deleted = [];
  const anchors = [];
  const text = [];
  const seen = new Set();
  for (const row of root.querySelectorAll('[data-l], [data-at], [data-old-l]')) {
    if (!range.intersectsNode(row)) continue;
    if (row.dataset.l !== undefined) {
      const line = +row.dataset.l;
      lines.push(line);
      if (seen.has(line)) continue;
      seen.add(line);
    } else if (row.dataset.at !== undefined) anchors.push(+row.dataset.at);
    if (row.dataset.oldL !== undefined && row.dataset.l === undefined)
      deleted.push(+row.dataset.oldL);
    const code = row.querySelector('.diff-code');
    if (code) text.push(clippedText(code, range));
  }
  if (!text.join('\n')) return null;
  const side = lines.length ? 'RIGHT' : 'LEFT';
  const last = Math.max(1, document.total || 1);
  const l1 = lines.length
    ? Math.min(...lines)
    : Math.max(1, Math.min(last, Math.min(...anchors) - 1));
  const l2 = lines.length ? Math.max(...lines) : Math.max(l1, Math.min(last, Math.max(...anchors)));
  return {
    text: text.join('\n'),
    l1,
    l2,
    delL1: deleted.length ? Math.min(...deleted) : 0,
    delL2: deleted.length ? Math.max(...deleted) : 0,
    path: document.path,
    fromDiff: true,
    side,
  };
}
