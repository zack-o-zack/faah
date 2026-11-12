/** A language-server position uses UTF-16 columns, like JavaScript strings. */
export function wordAtColumn(text, column) {
  const word = /[A-Za-z0-9_$]/;
  let start = Math.min(Math.max(0, column), text.length),
    end = start;
  while (start > 0 && word.test(text[start - 1])) start--;
  while (end < text.length && word.test(text[end])) end++;
  return start === end ? null : { word: text.slice(start, end), col: start };
}

const word = /[A-Za-z0-9_$]/;
export function movePosition(position, delta, textAt, total, axis = 'line') {
  let { line, col } = position;
  if (axis === 'line') return { line: Math.max(1, Math.min(total, line + delta)), col };
  const text = textAt(line - 1);
  col = Math.min(col, text.length);
  if (axis === 'word') {
    const direction = Math.sign(delta);
    for (let step = 0; step < Math.abs(delta); step++) {
      if (direction < 0) {
        if (col === 0 && line > 1) return { line: line - 1, col: textAt(line - 2).length };
        col = Math.max(0, col - 1);
        while (col > 0 && /\s/.test(text[col])) col--;
        const isWord = word.test(text[col]);
        while (col > 0 && !/\s/.test(text[col - 1]) && word.test(text[col - 1]) === isWord) col--;
      } else {
        if (col === text.length && line < total) return { line: line + 1, col: 0 };
        const isWord = word.test(text[col]);
        while (col < text.length && !/\s/.test(text[col]) && word.test(text[col]) === isWord) col++;
        while (col < text.length && /\s/.test(text[col])) col++;
      }
    }
  } else {
    col += delta;
    if (col < 0 && line > 1) return { line: line - 1, col: textAt(line - 2).length };
    if (col > text.length && line < total) return { line: line + 1, col: 0 };
  }
  return { line, col: Math.max(0, Math.min(text.length, col)) };
}
export function selectedText(anchor, head, textAt) {
  if (!anchor) return null;
  const reverse = anchor.line > head.line || (anchor.line === head.line && anchor.col > head.col);
  const start = reverse ? head : anchor;
  const end = reverse ? anchor : head;
  const lines = [];
  for (let line = start.line; line <= end.line; line++) {
    let text = textAt(line - 1);
    const from = line === start.line ? start.col : 0;
    const to = line === end.line ? end.col : text.length;
    lines.push(text.slice(from, to));
  }
  return { text: lines.join('\n'), l1: start.line, c1: start.col, l2: end.line, c2: end.col };
}
