import { expect, test } from 'bun:test';
import { StatusParser, NameStatusParser, mapXY } from '../src/git/status-parser.ts';
import { NumstatParser, recentCommit, unpushedCommit } from '../src/git/history-parser.ts';
import { readRecords } from '../src/git/records.ts';
import { parseGutter } from '../src/git/gutter.ts';
import { remoteHostPath } from '../src/git/remote.ts';
import { validSHA, atoi } from '../src/git/commands.ts';
import { highlightDiff } from '../src/render/diff.ts';
import { plain } from '../src/render/html.ts';
import captured from './git-fixtures.json';
import { comparableHighlight } from '../../test/contract/highlight.ts';

test('NUL records preserve split Unicode, malformed bytes, empty fields and final records', async () => {
  const bytes = Buffer.concat([Buffer.from('你😀\t\n\0\0last'), Buffer.from([0xf0, 0x9f])]);
  for (let offset = 0; offset <= bytes.length; offset++) {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, offset));
        controller.enqueue(bytes.subarray(offset));
        controller.close();
      },
    });
    const fields: string[] = [];
    await readRecords(stream, 0, (field) => fields.push(field));
    expect(fields).toEqual(['你😀\t\n', '', 'last��']);
  }
});

test('captured Git porcelain, conflict, log and numstat fixtures retain every field', () => {
  const parser = new StatusParser((path) => path);
  for (const field of captured.porcelain.split('\0')) parser.record(field);
  expect(parser.state.statuses).toEqual(
    Object.fromEntries([
      ['added file', 'A'],
      ['binary', 'A'],
      ['delete', 'D'],
      ['plain', 'M'],
      ['renamed new', 'R'],
      ['sub/partial', 'M'],
      ['__proto__', 'U'],
      ['你好\nname', 'U'],
    ]),
  );
  expect(parser.state.partial).toEqual({ 'sub/partial': true });
  expect(parser.state.staged).toEqual({
    'added file': true,
    binary: true,
    'renamed new': true,
    'sub/partial': true,
  });
  const conflict = new StatusParser((path) => path);
  for (const field of captured.conflict.split('\0')) conflict.record(field);
  expect(conflict.state.statuses).toEqual({ conflict: '!' });
  expect(conflict.state.staged).toEqual({ conflict: true });
  expect(recentCommit(captured.log.trim())).toEqual(captured.recent);
  const stats = new NumstatParser();
  for (const field of captured.numstat.split('\0')) stats.record(field);
  expect(stats.stats.get('renamed new')).toEqual({ add: 0, del: 0, binary: false });
  expect(stats.stats.get('sub/partial')).toEqual({ add: 1, del: 1, binary: false });
  expect(stats.stats.get('binary')).toEqual({ add: 0, del: 0, binary: true });
});

test('porcelain maps XY, rename source fields, conflicts and prototype-like names', () => {
  for (const [xy, status] of [
    ['.M', 'M'],
    ['M.', 'M'],
    ['AM', 'A'],
    ['.D', 'D'],
    ['R.', 'R'],
    ['C.', 'C'],
    ['UU', '!'],
    ['T.', 'M'],
    ['', 'M'],
  ])
    expect(mapXY(xy ?? '')).toBe(status ?? '');
  const parser = new StatusParser((path) => (path.startsWith('sub/') ? path.slice(4) : undefined));
  for (const field of [
    '? sub/__proto__',
    '? sub/你好\nname',
    '? outside.txt',
    '1 MM N... 100644 100644 100644 a b sub/partial name',
    '2 R. N... 100644 100644 100644 a b R100 sub/renamed',
    'sub/constructor',
    'u UU N... 100644 100644 100644 100644 a b c sub/conflict',
  ])
    parser.record(field);
  expect(Object.entries(parser.state.statuses)).toEqual([
    ['__proto__', 'U'],
    ['你好\nname', 'U'],
    ['partial name', 'M'],
    ['renamed', 'R'],
    ['conflict', '!'],
  ]);
  expect(parser.state.staged).toEqual({ 'partial name': true, renamed: true, conflict: true });
  expect(parser.state.partial).toEqual({ 'partial name': true });
});

test('name-status and numstat decode rename/copy, binary, tabs and malformed counts', () => {
  const records: unknown[] = [],
    names = new NameStatusParser((value) => records.push(value));
  for (const field of ['R100', 'old\tname', 'new\nname', 'C50', 'a', 'b', 'M', 'regular', ''])
    names.record(field);
  expect(records).toEqual([
    { status: 'R', from: 'old\tname', path: 'new\nname' },
    { status: 'C', from: 'a', path: 'b' },
    { status: 'M', path: 'regular' },
  ]);
  const stats = new NumstatParser();
  for (const field of ['2\t3\ta\tb', '-\t-\timage', '1\t0\t', 'old', 'new', 'bad\t5\tstrange'])
    stats.record(field);
  expect([...stats.stats]).toEqual([
    ['a\tb', { add: 2, del: 3, binary: false }],
    ['image', { add: 0, del: 0, binary: true }],
    ['new', { add: 1, del: 0, binary: false }],
    ['strange', { add: 0, del: 5, binary: false }],
  ]);
});

test('log fields, integer decoding and SHA validation retain Go behavior', () => {
  expect(recentCommit('abcd\x1fsubject\x1fT\x1f2 days ago\x1fabcdef')).toEqual({
    hash: 'abcd',
    subject: 'subject',
    author: 'T',
    date: '2 days ago',
    full: 'abcdef',
  });
  expect(unpushedCommit('abcdef\x1fabcd\x1fsubject\x1fT\x1fnow').short).toBe('abcd');
  expect(recentCommit('hash').full).toBe('');
  expect(atoi('4bad')).toBeUndefined();
  expect(atoi('9223372036854775808')).toBeUndefined();
  expect(atoi('-12')).toBe(-12);
  for (const value of ['abcd', 'ABCDEF', '0'.repeat(40)]) expect(validSHA(value)).toBe(true);
  for (const value of ['abc', 'g123', '--upload-pack=x', 'HEAD~1', '0'.repeat(41)])
    expect(validSHA(value)).toBe(false);
});

test('gutter replacements, insertions, deletion markers and missing-newline records match Go', () => {
  expect(parseGutter('')).toEqual({ added: [], modified: [], deleted: [] });
  expect(
    parseGutter(
      '@@ -1,3 +1,3 @@\n-old\n+new\n context\n+added\n gone\n@@ -9 +10 @@\n-deleted\n\\ No newline at end of file\n',
    ),
  ).toEqual({ added: [3], modified: [1], deleted: [9] });
  expect(parseGutter('@@ -1 +0,0 @@\n-all\n')).toEqual({ added: [], modified: [], deleted: [-1] });
});

test('remote spellings strip credentials and preserve host/path representation', () => {
  for (const raw of [
    'git@github.com:alice/repo.git',
    'ssh://git@github.com/alice/repo.git',
    'https://user:token@github.com/alice/repo.git',
  ])
    expect(remoteHostPath(raw)).toEqual({ host: 'github.com', path: 'alice/repo' });
  expect(remoteHostPath('https://GitHub.com:443/alice/a%20b.git')).toEqual({
    host: 'GitHub.com:443',
    path: 'alice/a b',
  });
  expect(remoteHostPath('ssh://git@host:2222/alice/repo')).toEqual({
    host: 'host:2222',
    path: 'alice/repo',
  });
  expect(remoteHostPath('/tmp/repo.git')).toBeUndefined();
  expect(remoteHostPath('https://host/a%xx')).toBeUndefined();
});

test('diff rows preserve Go line fields, sections and side-specific code context', async () => {
  const calls: string[] = [];
  const highlight = async (source: string, _lang: string, want: number) => {
    calls.push(source);
    return plain(source, want);
  };
  expect(
    await highlightDiff('a.bin', 'Binary files a/a.bin and b/a.bin differ\n', highlight),
  ).toBeNull();
  const hunks = await highlightDiff(
    'a.go',
    '@@ -1,2 +1,2 @@ section\n one\n-old\n+new\n\\ No newline at end of file\n@@ -0,0 +1 @@\n+\n',
    highlight,
  );
  expect(hunks).toEqual([
    {
      oldStart: 1,
      newStart: 1,
      section: 'section',
      rows: [
        { type: 'ctx', oldLine: 1, newLine: 1, text: 'one', html: 'one' },
        { type: 'del', oldLine: 2, at: 2, text: 'old', html: 'old' },
        { type: 'add', newLine: 2, text: 'new', html: 'new' },
      ],
    },
    { oldStart: 0, newStart: 1, rows: [{ type: 'add', newLine: 1, text: '' }] },
  ]);
  expect(calls).toEqual(['one\nold', 'one\nnew', '']);
  expect(await highlightDiff('unknown.zzzzz', '@@ -0,0 +1 @@\n+<&>\n', highlight)).toEqual([
    {
      oldStart: 0,
      newStart: 1,
      rows: [{ type: 'add', newLine: 1, text: '<&>', html: '&lt;&amp;&gt;' }],
    },
  ]);
  expect(calls).toHaveLength(3);
});

test('diff comparator permits only token-wrapper differences, keeping row metadata and text exact', () => {
  const value = (html: string, newLine = 1) => ({
    status: 200,
    body: {
      diff: '+raw',
      hunks: [{ oldStart: 0, newStart: 1, rows: [{ type: 'add', newLine, text: 'x', html }] }],
    },
  });
  const expected = comparableHighlight(value('<i class=k>x</i>'), 'api/diff?path=a.go');
  expect(comparableHighlight(value('<span class="nf">x</span>'), 'api/diff?path=a.go')).toEqual(
    expected,
  );
  expect(comparableHighlight(value('y'), 'api/diff')).not.toEqual(expected);
  expect(comparableHighlight(value('x', 2), 'api/diff')).not.toEqual(expected);
  expect(() => comparableHighlight(value('<i class=unknown>x</i>'), 'api/diff')).toThrow(
    'unknown highlight',
  );
  expect(() => comparableHighlight(value('<i class=k>x</span>'), 'api/diff')).toThrow('malformed');
});
