import { expect, test } from 'vitest';
import { emptyFileItems, itemParts, paletteSections } from './logic.ts';

test('empty items preserve tab order after the active tab and limit only open files', () => {
  const documents = Array.from({ length: 7 }, (_, index) => ({
    name: `${index}.ts`,
    path: `src/${index}.ts`,
  }));
  const items = emptyFileItems(documents, 'src/6.ts');
  expect(items.map((item) => item.label)).toEqual([
    '6.ts',
    '0.ts',
    '1.ts',
    '2.ts',
    '3.ts',
    'Symbol in this file',
    'Line',
    'Run a command',
    'Open a pull request',
  ]);
  expect(items[0]).toMatchObject({ kind: 'open-file', sub: 'src' });
  expect(documents[0]?.path).toBe('src/0.ts');
});
test('grouping derives headings from items and preserves flat indices', () => {
  expect(paletteSections(emptyFileItems([], undefined))).toMatchObject([
    { label: 'Jump to', entries: [{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }] },
  ]);
  expect(paletteSections([])).toEqual([]);
  const item = {
    kind: 'file',
    path: 'src/store.ts',
    label: 'store.ts',
    sub: 'src',
    positions: [0, 4, 5],
  } as const;
  expect(paletteSections([{ ...item, positions: [...item.positions] }])[0]?.label).toBeUndefined();
  expect(itemParts({ ...item, positions: [...item.positions] })).toEqual([
    { text: 'st', bold: true },
    { text: 'ore.ts', bold: false },
  ]);
});
