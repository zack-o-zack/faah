import { test, expect } from 'bun:test';
import {
  familyFor,
  identRe,
  compileDeclFamily,
  declPatterns,
  outlineText,
  indentCols,
  outline,
} from '../src/symbols/service.ts';
import { goOutline, markdownOutline } from '../bench/vectors.ts';

test('Go language families, identifiers and declaration patterns', () => {
  const groups: Record<string, string[]> = {
    go: ['go'],
    py: ['py', 'pyi'],
    js: ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts'],
    rs: ['rs'],
    c: ['c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh'],
    jvm: ['java', 'kt', 'kts', 'scala', 'cs', 'swift'],
    rb: ['rb'],
    sh: ['sh', 'bash', 'zsh'],
    php: ['php'],
    lua: ['lua'],
    zig: ['zig'],
    ex: ['ex', 'exs'],
    hs: ['hs'],
  };
  for (const [family, exts] of Object.entries(groups))
    for (const ext of exts) expect(familyFor('.' + ext)).toBe(family);
  expect(familyFor('.txt')).toBe('');
  expect(familyFor('')).toBe('');
  for (const id of ['foo', '_bar', 'Baz123', '$name', 'CamelCase', '_'])
    expect(identRe.test(id)).toBe(true);
  for (const id of ['123foo', 'foo-bar', 'foo bar', 'foo.bar', 'foo/bar', 'foo+bar', '', 'foo\n'])
    expect(identRe.test(id)).toBe(false);
  expect(compileDeclFamily('nonexistent', 'Foo')).toBeUndefined();
  expect(compileDeclFamily('go', '[invalid-regex(')).toBeUndefined();
  expect(compileDeclFamily('go', 'MyFunc')?.test('func MyFunc() {')).toBe(true);
  expect(compileDeclFamily('go', 'MyFunc')?.test('func OtherFunc() {')).toBe(false);
  expect(declPatterns('invalid-ident')).toBeUndefined();
  const patterns = declPatterns('HandleRequest');
  expect(patterns?.get('.go')?.test('func HandleRequest(w http.ResponseWriter) {')).toBe(true);
  expect(patterns?.get('.py')?.test('def HandleRequest():')).toBe(true);
  expect(patterns?.has('.ts')).toBe(true);
  expect(patterns?.get('.py')?.test('def\u00a0HandleRequest():')).toBe(false);
});

test('Go outline vectors for Go, Markdown, Python, TypeScript, Rust and shell', async () => {
  await expect(outline('/nonexistent-path-px0/missing.go', 'missing.go')).rejects.toThrow();
  expect(await outline(import.meta.dir, 'test')).toEqual([]);
  expect(outlineText('hello world\n', 'test.txt')).toEqual([]);
  expect(outlineText(goOutline, 'bench.go').map((s) => s.name)).toEqual([
    'Client',
    'Version',
    'DefaultClient',
    'NewClient',
    'Send',
  ]);
  expect(outlineText(markdownOutline, 'README.md').map((s) => [s.name, s.kind, s.indent])).toEqual([
    ['Title', 'heading', 0],
    ['Section 1', 'heading', 1],
    ['Subsection 1.1', 'heading', 2],
    ['Section 2', 'heading', 1],
  ]);
  const python =
    'class Worker:\n    def __init__(self):\n        pass\n\n    async def execute(self):\n        pass\n\ndef global_helper():\n    pass\n';
  expect(outlineText(python, 'sample.py').map((s) => [s.name, s.kind, s.indent])).toEqual([
    ['Worker', 'class', 0],
    ['__init__', 'method', 2],
    ['execute', 'method', 2],
    ['global_helper', 'def', 0],
  ]);
  const ts =
    'export interface User {\n id: string;\n}\nexport type ID = string;\nexport enum Role { Admin, User }\nexport class AppService {}\nexport const helper = async () => {};\nexport function main() {}\n';
  expect(outlineText(ts, 'sample.ts').map((s) => s.name)).toEqual([
    'User',
    'ID',
    'Role',
    'AppService',
    'helper',
    'main',
  ]);
  const rust =
    'pub mod config;\npub struct Client;\npub enum Status { Active }\npub trait Service {}\nimpl Service for Client {\n    pub fn connect() {}\n}\npub type Result<T> = std::result::Result<T, ()>;\npub const MAX_RETRIES: usize = 3;\n';
  expect(outlineText(rust, 'sample.rs').map((s) => s.name)).toEqual([
    'config',
    'Client',
    'Status',
    'Service',
    'Service for Client',
    'connect',
    'Result',
    'MAX_RETRIES',
  ]);
  expect(
    outlineText(
      '#!/usr/bin/env bash\nfunction build_all {\n echo "building"\n}\ncleanup() {\n echo "clean"\n}\n',
      'script.sh',
    ).map((s) => s.name),
  ).toEqual(['build_all', 'cleanup']);
  for (const [ws, n] of [
    ['', 0],
    ['  ', 1],
    ['    ', 2],
    ['\t', 2],
    ['\t  ', 3],
    ['😀\t', 2],
    ['😀😀', 1],
  ] as const)
    expect(indentCols(ws)).toBe(n);
  expect(
    outlineText(
      'func Before() {}\n' + 'x'.repeat(256 * 1024) + '\nfunc After() {}',
      'sample.go',
    ).map((s) => s.name),
  ).toEqual(['Before']);
  expect(outlineText('func\u00a0Wrong() {}', 'sample.go')).toEqual([]);
});
