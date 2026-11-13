import { required } from '../lib/test-values.ts';
import { describe, test, expect } from 'vitest';
import fixture from './fixtures/edit-disposal.diff?raw';
import metadataFixture from './fixtures/metadata-reload.diff?raw';
import { parseDiff, serializeHunk } from './diff-parse.ts';
import {
  pairRows,
  splitRows,
  unifiedRows,
  gutterAnchor,
  gutterSelection,
  expandContext,
  diagnosticMap,
  commitStepTarget,
  rowOffsets,
  measuredWindow,
} from './diff-rows.ts';
import { changedRanges, syntaxParts } from './diff-intraline.ts';

const diff =
  '@@ -2,4 +2,5 @@ function example\n keep\n-old value\n-old tail\n+new value\n+new tail\n+extra\n end\n';
test('parses a real editor disposal patch and round trips its line numbers', () => {
  const hunk = required(parseDiff(fixture)[0]);
  expect(hunk.oldStart).toBe(35);
  expect(hunk.newStart).toBe(35);
  expect(hunk.rows.filter((row) => row.type === 'add')).toHaveLength(2);
  expect(hunk.rows.find((row) => row.type === 'del')?.oldLine).toBe(39);
  expect(parseDiff(serializeHunk(hunk))).toEqual([{ ...hunk, section: '' }]);
});
test('ignores git headers and no-newline markers; handles zero-length ranges', () => {
  expect(
    parseDiff(
      'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -0,0 +1 @@\n+hello\n\\ No newline at end of file\n',
    ),
  ).toEqual([
    { oldStart: 0, newStart: 1, section: '', rows: [{ type: 'add', newLine: 1, text: 'hello' }] },
  ]);
  expect(parseDiff('Binary files differ')).toEqual([]);
});
test('preserves blank context lines and deletion anchors across multiple hunks', () => {
  const hunks = parseDiff('@@ -1,2 +1 @@\n \n-gone\n@@ -20 +19 @@\n-old\n+new\n');
  expect(hunks).toHaveLength(2);
  expect(hunks[0]?.rows[0]?.text).toBe('');
  expect(gutterAnchor(hunks[0]?.rows[1])).toEqual({ line: undefined, at: 2, oldLine: 2 });
  expect(gutterAnchor(hunks[1]?.rows[1])).toEqual({ line: 19, at: undefined, oldLine: undefined });
});
test('split pairs changed runs, pads additions and repeats context', () => {
  const rows = required(parseDiff(diff)[0]).rows;
  const pairs = pairRows(rows);
  expect(pairs).toHaveLength(5);
  expect(pairs[0]?.left).toBe(pairs[0]?.right);
  expect(pairs[3]).toMatchObject({ left: null, right: { text: 'extra', newLine: 5 } });
  expect(
    required(required(splitRows(rows)[1]).left)
      .parts.map((p) => p.text)
      .join(''),
  ).toBe('old value');
});
test('unified rows preserve original order and all gutter positions', () => {
  const rows = required(parseDiff(diff)[0]).rows;
  expect(unifiedRows(rows).map((row) => row.text)).toEqual(rows.map((row) => row.text));
  expect(unifiedRows(rows).map(gutterAnchor)).toEqual(rows.map(gutterAnchor));
});
describe('bounded intraline changes', () => {
  test.each([
    ['const count = 1;', 'const count = 2;'],
    ['alpha beta', 'alpha bright beta'],
    ['', 'new'],
    ['gone', ''],
    ['a😀 & b', 'a😀 & c'],
    ['x'.repeat(2000), 'x'.repeat(1999) + 'y'],
    ['unchanged', 'unchanged'],
  ])('retains both source strings for %s → %s', (old, next) => {
    const ranges = changedRanges(old, next);
    expect(
      syntaxParts(old, '', ranges.old, ranges.oldBars, 'del')
        .map((p) => p.text)
        .join(''),
    ).toBe(old);
    expect(
      syntaxParts(next, '', ranges.next, ranges.newBars, 'add')
        .map((p) => p.text)
        .join(''),
    ).toBe(next);
    expect([...ranges.old].some(Boolean) || [...ranges.next].some(Boolean)).toBe(old !== next);
  });
  test('keeps syntax tokens and decoded entities while highlighting only changes', () => {
    expect(syntaxParts('func greet', '<i class=k>func</i> <i class=nf>greet</i>')).toEqual([
      { text: 'func', className: 'k' },
      { text: ' ', className: '' },
      { text: 'greet', className: 'nf' },
    ]);
    const ranges = changedRanges('const x = "<&"', 'const x = "<>"');
    const parts = syntaxParts(
      'const x = "<&"',
      '<i class="k">const</i> x = &quot;&lt;&amp;&quot;',
      ranges.old,
      ranges.oldBars,
      'del',
    );
    expect(parts[0]).toEqual({ text: 'const', className: 'k' });
    expect(parts.find((part) => part.className.includes('diff-char-del'))?.text).toBe('&');
    expect(syntaxParts('text', '<img src=x onerror=alert(1)>wrong')).toEqual([
      { text: 'text', className: '' },
    ]);
  });
  test('marks the empty side of an insertion and deletion', () => {
    const inserted = changedRanges('ab', 'aXb');
    expect([...inserted.oldBars]).toEqual([1]);
    const deleted = changedRanges('aXb', 'ab');
    expect([...deleted.newBars]).toEqual([1]);
  });
});
test('expands context at file boundaries without changing anchors', () => {
  const hunk = required(parseDiff('@@ -3 +3 @@\n-old\n+new\n')[0]);
  const expanded = expandContext(hunk, ['one', 'two', 'new', 'four']);
  expect(expanded.oldStart).toBe(1);
  expect(expanded.rows.map((row) => row.text)).toEqual(['one', 'two', 'old', 'new', 'four']);
  expect(expanded.rows[2]?.at).toBe(3);
  expect(expandContext({ ...hunk, rows: [] }, [])).toEqual({ ...hunk, rows: [] });
});
test('diagnostics prefer errors and file stepping skips binary entries', () => {
  expect(
    diagnosticMap([
      { line: 1, severity: 2 },
      { line: 1, severity: 1 },
    ]).get(1)?.severity,
  ).toBe(1);
  expect(commitStepTarget([{}, { binary: true }, {}], 0, 1)).toBe(2);
  expect(commitStepTarget([{}, { binary: true }, {}], 2, 1)).toBe(-1);
});
test('large row windows stay bounded at the beginning, middle and end', () => {
  for (const top of [0, 100000, 400000, 1000000]) {
    const view = measuredWindow(rowOffsets(20000, new Map()), top, 900);
    expect(view.end - view.start).toBeLessThanOrEqual(86);
    expect(view.before + view.after + (view.end - view.start) * 20).toBe(400000);
  }
  expect(measuredWindow(rowOffsets(100, new Map()), 0, 900)).toEqual({
    start: 0,
    end: 100,
    before: 0,
    after: 0,
  });
});

test('measured offsets preserve wrapped row heights and source navigation geometry', () => {
  const offsets = rowOffsets(
    1000,
    new Map([
      [0, 80],
      [1, 40],
      [500, 60],
    ]),
  );
  expect(offsets[2]).toBe(120);
  const view = measuredWindow(offsets, offsets[500] ?? 0, 200);
  expect(view.start).toBe(480);
  expect(view.before).toBe(offsets[480]);
  expect(view.before + view.after + (offsets[view.end] ?? 0) - (offsets[view.start] ?? 0)).toBe(
    offsets[1000],
  );
});

test('real metadata reload patch preserves separate hunk offsets and highlighted text', () => {
  const hunks = parseDiff(metadataFixture);
  expect(hunks).toHaveLength(3);
  for (const hunk of hunks) {
    expect(unifiedRows(hunk.rows).map((row) => row.text)).toEqual(hunk.rows.map((row) => row.text));
    expect(parseDiff(serializeHunk(hunk))[0]?.rows).toEqual(hunk.rows);
  }
});

test('gutter actions retain deleted-side PR lines and working-tree selection anchors', () => {
  expect(
    gutterSelection({ type: 'del', oldLine: 20, at: 18, text: 'removed' }, 'file.js'),
  ).toMatchObject({ path: 'file.js', l1: 17, l2: 18, delL1: 20, delL2: 20, side: 'LEFT' });
  expect(
    gutterSelection({ type: 'ctx', oldLine: 20, newLine: 18, text: 'context' }, 'file.js', false),
  ).toMatchObject({ l1: 18, l2: 18, side: 'RIGHT', reviewable: false });
});
test('intraline spans keep surrogate pairs intact when an emoji changes', () => {
  const ranges = changedRanges('a😀b', 'a😁b');
  const parts = syntaxParts('a😀b', '', ranges.old, ranges.oldBars, 'del');
  expect(parts.find((part) => part.className === 'diff-char-del')?.text).toBe('😀');
});
