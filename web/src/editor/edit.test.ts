import { expect, test } from 'vitest';
import { textChange, textOffsets, updateTextOffsets } from './edit.ts';

const replacements: [string, number, number, string][] = [
  ['', 0, 0, ''],
  ['', 0, 0, '\n'],
  ['abc', 0, 3, ''],
  ['abc\ndef\nghi', 1, 7, 'X\nY\nZ'],
  ['a\nb', 2, 2, '\n'],
  ['a\nb', 0, 2, ''],
  ['a\nb', 1, 2, ''],
  ['a\r\nb\r\nc', 2, 5, '\r\n\r\n'],
  ['a\r\nb', 2, 3, ''],
  ['a\nb\n', 0, 4, '\r\n'],
  ['😀\nβ\n', 2, 3, '漢字\n'],
];
for (const [before, start, end, inserted] of replacements)
  test(`incremental starts match a rescan for ${JSON.stringify([before, start, end, inserted])}`, () => {
    const after = before.slice(0, start) + inserted + before.slice(end);
    expect(updateTextOffsets(textOffsets(before), textChange(before, after))).toEqual(
      textOffsets(after),
    );
  });

test('replacement boundaries and unchanged blocks remain exact over repeated edits', () => {
  let before = 'hello\r\nworld\n'.repeat(4000);
  let starts = textOffsets(before);
  for (let index = 0; index < 150; index++) {
    const start = (index * 7919) % (before.length + 1);
    const end = Math.min(before.length, start + (index % 17));
    const inserted = ['x', '\r\n', '', 'one\ntwo\n', '😀'][index % 5] || '';
    const after = before.slice(0, start) + inserted + before.slice(end);
    const change = textChange(before, after);
    expect(
      before.slice(0, change.start) +
        change.inserted +
        before.slice(change.start + change.removed.length),
    ).toBe(after);
    starts = updateTextOffsets(starts, change);
    expect(starts).toEqual(textOffsets(after));
    before = after;
  }
});
