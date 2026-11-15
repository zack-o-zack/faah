import { lineText } from '../editor/layout.ts';
export function indentCols(html: string): number {
  let columns = 0;
  for (const char of /^\s*/.exec(lineText(html))?.[0] || '')
    columns += char === '\t' ? 4 - (columns % 4) : 1;
  return columns;
}
export function marginWidth(width: number, blocks: boolean): number {
  if (!blocks) return 0;
  return width < 900 ? 24 : 260;
}
export function stackTops(items: { top: number; height: number }[], gap = 8): number[] {
  let bottom = -Infinity;
  return items.map((item) => {
    const top = Math.max(item.top, bottom + gap);
    bottom = top + item.height;
    return top;
  });
}
export function peekGroups<T extends { l1: number; l2: number }>(
  notes: T[],
): { notes: T[]; lines: number[] }[] {
  const groups: { notes: T[]; shown: Set<number>; last: number }[] = [];
  for (const note of [...notes].sort((a, b) => a.l1 - b.l1 || b.l2 - a.l2)) {
    let group = groups.at(-1);
    if (!group || note.l1 > group.last + 3) {
      group = { notes: [], shown: new Set(), last: note.l2 };
      groups.push(group);
    }
    group.notes.push(note);
    group.last = Math.max(group.last, note.l2);
    for (
      let line = note.l1;
      line <= Math.min(note.l2, note.l2 - note.l1 < 8 ? note.l2 : note.l1 + 5);
      line++
    )
      group.shown.add(line);
    group.shown.add(note.l2);
  }
  return groups.map((group) => {
    const lines: number[] = [];
    for (const line of [...group.shown].sort((a, b) => a - b)) {
      const previous = lines.at(-1);
      if (previous && line - previous > 3) lines.push(0);
      else if (previous) for (let k = previous + 1; k < line; k++) lines.push(k);
      lines.push(line);
    }
    return { notes: group.notes, lines };
  });
}
