export function textChange(before, after) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return { start, removed: before.slice(start, oldEnd), inserted: after.slice(start, newEnd) };
}
export function textOffsets(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index++)
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  return starts;
}
export function indentEdit(text, start, end, outdent = false) {
  if (start === end && !outdent) return { start, end, replacement: '    ' };
  const first = text.lastIndexOf('\n', start - 1) + 1;
  const next = text.indexOf('\n', end);
  const last = next < 0 ? text.length : next;
  const replacement = text
    .slice(first, last)
    .split('\n')
    .map((line) => {
      if (!outdent) return '    ' + line;
      return line.replace(/^( {1,4}|\t)/, '');
    })
    .join('\n');
  return { start: first, end: last, replacement };
}
