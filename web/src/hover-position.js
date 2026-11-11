/** A language-server position uses UTF-16 columns, like JavaScript strings. */
export function wordAtColumn(text, column) {
  const word = /[A-Za-z0-9_$]/;
  let start = Math.min(Math.max(0, column), text.length), end = start;
  while (start > 0 && word.test(text[start - 1])) start--;
  while (end < text.length && word.test(text[end])) end++;
  return start === end ? null : { word: text.slice(start, end), col: start };
}
