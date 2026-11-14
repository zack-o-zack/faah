import { filenameLanguage } from './language.ts';
import { escape } from './html.ts';
import type { Highlight } from './document.ts';
import { atoi } from '../git/commands.ts';

export interface RenderDiffRow {
  type: string;
  oldLine?: number;
  newLine?: number;
  at?: number;
  text: string;
  html?: string;
}
export interface RenderDiffHunk {
  oldStart: number;
  newStart: number;
  section?: string;
  rows: RenderDiffRow[];
}
const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@[ \t]?(.*)$/;

export async function highlightDiff(
  path: string,
  diff: string,
  highlight: Highlight,
): Promise<RenderDiffHunk[] | null> {
  if (!diff) return [];
  const hunks: RenderDiffHunk[] = [];
  let current: RenderDiffHunk | undefined,
    oldLine = 0,
    newLine = 0,
    count = 0;
  for (const line of diff.split('\n')) {
    if (++count % 1024 === 0) await Bun.sleep(0);
    const match = header.exec(line);
    if (match) {
      oldLine = atoi(match[1] ?? '') ?? 0;
      newLine = atoi(match[3] ?? '') ?? 0;
      current = {
        oldStart: oldLine,
        newStart: newLine,
        ...(match[5] ? { section: match[5] } : {}),
        rows: [],
      };
      hunks.push(current);
    } else if (current && line && !line.startsWith('\\')) {
      const type = line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : 'ctx';
      current.rows.push({
        type,
        text: line.slice(1),
        ...(type !== 'add' && oldLine ? { oldLine } : {}),
        ...(type !== 'del' && newLine ? { newLine } : {}),
        ...(type === 'del' && newLine ? { at: newLine } : {}),
      });
      if (type !== 'add') oldLine++;
      if (type !== 'del') newLine++;
    }
  }
  if (!hunks.length) return null;
  const lang = filenameLanguage(path);
  for (const hunk of hunks) {
    if (!lang) {
      for (const row of hunk.rows) {
        const html = escape(row.text);
        if (html) row.html = html;
      }
      continue;
    }
    const oldRows = hunk.rows.filter((r) => r.type !== 'add').map((r) => r.text),
      newRows = hunk.rows.filter((r) => r.type !== 'del').map((r) => r.text);
    const oldHTML = oldRows.length ? await highlight(oldRows.join('\n'), lang, oldRows.length) : [];
    const newHTML = newRows.length ? await highlight(newRows.join('\n'), lang, newRows.length) : [];
    let oldIndex = 0,
      newIndex = 0;
    for (const row of hunk.rows) {
      const html = row.type === 'del' ? oldHTML[oldIndex] : newHTML[newIndex];
      if (row.type !== 'add') oldIndex++;
      if (row.type !== 'del') newIndex++;
      if (html) row.html = html;
    }
  }
  return hunks;
}
