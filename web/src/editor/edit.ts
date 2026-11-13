export interface TextChange {
  start: number;
  removed: string;
  inserted: string;
}

export function textChange(before: string, after: string): TextChange {
  let start = 0;
  // Native substring comparisons avoid a JavaScript iteration for every unchanged character.
  const block = 4096;
  const limit = Math.min(before.length, after.length);
  while (
    start + block <= limit &&
    before.slice(start, start + block) === after.slice(start, start + block)
  )
    start += block;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (
    oldEnd - block >= start &&
    newEnd - block >= start &&
    before.slice(oldEnd - block, oldEnd) === after.slice(newEnd - block, newEnd)
  ) {
    oldEnd -= block;
    newEnd -= block;
  }
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return { start, removed: before.slice(start, oldEnd), inserted: after.slice(start, newEnd) };
}
export function textOffsets(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++)
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  return starts;
}

/** Preserve starts outside the replacement; only its inserted text needs scanning. */
export function updateTextOffsets(starts: readonly number[], change: TextChange): number[] {
  const end = change.start + change.removed.length;
  const delta = change.inserted.length - change.removed.length;
  const next: number[] = [];
  for (const offset of starts) {
    if (offset > change.start) break;
    next.push(offset);
  }
  for (let index = 0; index < change.inserted.length; index++)
    if (change.inserted.charCodeAt(index) === 10) next.push(change.start + index + 1);
  for (const offset of starts) if (offset > end) next.push(offset + delta);
  return next;
}
export function indentEdit(
  text: string,
  start: number,
  end: number,
  outdent = false,
): { start: number; end: number; replacement: string } {
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
