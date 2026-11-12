export const LH = 20;
export const CHUNK = 1000;
export const OVERSCAN = 24;

const entities = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
export function lineText(html = '') {
  return html.replace(/<[^>]*>/g, '').replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (entity, name) => {
    if (name[0] !== '#') return entities[name] ?? entity;
    const value =
      name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : entity;
  });
}
export function htmlTextLen(html, tabSize = 4) {
  if (!html) return 0;
  const text = lineText(html);
  let column = 0;
  for (let index = 0; index < text.length; index++) {
    column += text[index] === '\t' ? tabSize - (column % tabSize) : 1;
  }
  return column;
}
export function lineOffsets(
  columns,
  { wrap = false, width = 800, charWidth = 7.8, lineHeight = LH, estimate = 0, heights } = {},
) {
  const offsets = new Float64Array(columns.length + 1);
  const capacity = Math.max(1, Math.floor(Math.max(1, width) / charWidth));
  for (let index = 0; index < columns.length; index++) {
    const length = columns[index] < 0 ? estimate : columns[index];
    const rows = wrap ? Math.max(1, Math.ceil(length / capacity)) : 1;
    offsets[index + 1] = offsets[index] + ((wrap && heights?.get(index)) || rows * lineHeight);
  }
  return offsets;
}
export function lineIndexAtY(offsets, y) {
  const total = offsets.length - 1;
  if (!total || y <= 0) return 0;
  let low = 0;
  let high = total - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (offsets[middle + 1] <= y) low = middle + 1;
    else high = middle;
  }
  return low;
}
export function visibleRange(offsets, scrollTop, height, overscan = OVERSCAN * LH) {
  const total = offsets.length - 1;
  if (!total) return { first: 0, last: 0 };
  const first = lineIndexAtY(offsets, Math.max(0, scrollTop - overscan));
  const last = Math.min(total, lineIndexAtY(offsets, scrollTop + height + overscan) + 2);
  return { first, last };
}
export function codeWidth(width, total, charWidth, numbers = true) {
  const gutter = numbers ? String(total || 1).length * charWidth + 30 : 0;
  return Math.max(40, width - gutter - 40);
}

export function visualColumn(text, column, tabSize = 4) {
  let width = 0;
  for (const char of text.slice(0, column)) {
    const code = char.codePointAt(0);
    if (char === '\t') width += tabSize - (width % tabSize);
    else if (/\p{Mark}/u.test(char)) continue;
    else if (
      code >= 0x1100 &&
      (code <= 0x115f ||
        (code >= 0x2e80 && code <= 0xa4cf) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        code >= 0x1f300)
    )
      width += 2;
    else width++;
  }
  return width;
}
