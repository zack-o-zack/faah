export interface Position {
  line: number;
  col: number;
}
export interface Word {
  word: string;
  col: number;
}
export interface SelectedText {
  text: string;
  l1: number;
  c1: number;
  l2: number;
  c2: number;
}
/** A language-server position uses UTF-16 columns, like JavaScript strings. */
export function wordAtColumn(text: string, column: number): Word | null {
  const word = /[A-Za-z0-9_$]/;
  let start = Math.min(Math.max(0, column), text.length),
    end = start;
  while (start > 0 && word.test(text[start - 1] || '')) start--;
  while (end < text.length && word.test(text[end] || '')) end++;
  return start === end ? null : { word: text.slice(start, end), col: start };
}

const word = /[A-Za-z0-9_$]/;
export function movePosition(
  position: Position,
  delta: number,
  textAt: (index: number) => string,
  total: number,
  axis = 'line',
): Position {
  let { line, col } = position;
  if (axis === 'line') return { line: Math.max(1, Math.min(total, line + delta)), col };
  const direction = Math.sign(delta);
  for (let step = 0; step < Math.abs(delta); step++) {
    const text = textAt(line - 1);
    col = Math.min(col, text.length);
    if (direction < 0 && col === 0 && line > 1) {
      line--;
      col = textAt(line - 1).length;
      continue;
    }
    if (direction > 0 && col === text.length && line < total) {
      line++;
      col = 0;
      continue;
    }
    if (axis === 'word' && direction < 0) {
      col = Math.max(0, col - 1);
      while (col > 0 && /\s/.test(text[col] || '')) col--;
      const isWord = word.test(text[col] || '');
      while (
        col > 0 &&
        !/\s/.test(text[col - 1] || '') &&
        word.test(text[col - 1] || '') === isWord
      )
        col--;
    } else if (axis === 'word') {
      const isWord = word.test(text[col] || '');
      while (
        col < text.length &&
        !/\s/.test(text[col] || '') &&
        word.test(text[col] || '') === isWord
      )
        col++;
      while (col < text.length && /\s/.test(text[col] || '')) col++;
    } else col = Math.max(0, Math.min(text.length, col + direction));
  }
  return { line, col };
}

export function selectedText(
  anchor: Position | null,
  head: Position,
  textAt: (index: number) => string,
): SelectedText | null {
  if (!anchor) return null;
  const reverse = anchor.line > head.line || (anchor.line === head.line && anchor.col > head.col);
  const start = reverse ? head : anchor;
  const end = reverse ? anchor : head;
  const lines = [];
  for (let line = start.line; line <= end.line; line++) {
    const text = textAt(line - 1);
    const from = line === start.line ? start.col : 0;
    const to = line === end.line ? end.col : text.length;
    lines.push(text.slice(from, to));
  }
  return { text: lines.join('\n'), l1: start.line, c1: start.col, l2: end.line, c2: end.col };
}
