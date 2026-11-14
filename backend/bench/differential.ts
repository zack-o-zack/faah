import { comparableHighlight } from '../../test/contract/highlight.ts';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fixture } from '../../test/contract/fixtures.ts';
import { launch } from '../../bench/launch.ts';
import { ready } from '../../bench/http.ts';
import { parse } from '../src/decode.ts';
const go = process.env.FAAH_LEGACY_BIN,
  bun = process.env.FAAH_BIN;
if (!go || !bun) throw new Error('Set FAAH_LEGACY_BIN and FAAH_BIN');
const f = await fixture();
try {
  await f.write('parity.txt', 'a ab aaa\n A\tB 123 _é é_\n你好 needle\nK k K S s ſ É é İ i\n\n');
  await f.write('invalid.txt', Buffer.from([0xe2, 0x82, 10, 0xf0, 0x9f, 0x98, 0x80]));
  await f.write('icon.ico', Buffer.from([0, 0, 1, 0]));
  const queries = [
    'a*',
    'a?',
    '^',
    '$',
    '\\A',
    '\\z',
    '\\w+',
    '[\\w]+',
    '[^\\w]+',
    '\\s+',
    '[\\s]+',
    '\\b',
    '\\B',
    '\\d+',
    '\\Q[a]\\E',
    'a\\nb',
    'a\nb',
    'a|\\n',
    '[a\\n]',
    '[^\\n]',
    '(?s:a.b)',
    '(?m:^a)',
    '[',
    '(',
    ')',
    '*',
    '(?=a)',
    'a{1001}',
    '[a&&b]',
    '[a~~b]',
    '[a[b]',
    '[[:alpha:]\\d]+',
    '[]a]',
    '[a{1001}]',
    '[^]a]',
    '[[:alpha:]\\w]+',
    '[[:alpha:]\\D]+',
    '[a--b]',
    '\\x{61}',
    '\\077',
    'a{2,1}',
    'a**',
    '(?P<name>a)',
    '(?i:a)',
    '(a?)*',
    'a*|b',
    '\\p{Greek}',
    '\\pL',
    '\\C',
    '[--0]',
    '[a-z--]',
    '[[:alpha:]{1001}]',
    '[]a{1001}]',
    '\\123',
    'a|\\012',
    'a|\\x0a',
    '\\q',
    'abc\\q',
    '[z-a]',
    'a{1,2}*',
    'a*?+',
    'a*[x]*',
    'a{01}',
    '(?P<x>a)(?P<x>b)',
    '(a{100}){100}',
    'a{1,01}',
    'a{,2}',
  ];
  const paths = queries.map(
    (q) => 'api/search?' + new URLSearchParams({ q, re: '1', glob: 'parity.txt' }),
  );
  paths.push('api/search?' + new URLSearchParams({ q: 'a\nb', glob: 'parity.txt' }));
  for (const path of ['icon.ico', 'src', '', 'missing'])
    paths.push('api/raw?' + new URLSearchParams({ path }));
  for (const path of ['', '..', '../../outside.go', '/outside.go', 'src/hello.go'])
    paths.push('api/def?' + new URLSearchParams({ sym: 'Hello', path }));
  for (const path of ['', 'src', 'missing'])
    paths.push('api/outline?' + new URLSearchParams({ path }));
  const baseCases = paths.length;
  const markdownCases = [
    '`"quoted" & <code>` and ![**bold** `code`](x.png "a & b")\n',
    '# [linked](x) `code` ![alt](x.png)\n',
    '```go\rpackage main\rvar x = 1\r```\r',
    '---\n\n> ## nested\n>\n> paragraph\n',
    '```text\nline\rnext\n```\n',
    '~single~ ~~double~~ ~mismatch~~ a~b~c ~~~triple~~~\n',
    '<code> https://example.com/a </code>\n',
    '<a href="x"> https://example.com/a </a>\n',
    'www.example.com test@example.com http://localhost:5000/ SECURITY.md\n',
    'https://example.com/a?b=1&amp;c=2.\n',
    '<https://例え.com/你好> [x](https://例え.com/你好)\n',
    'email foo@example.com and foo@example.com_bad\n',
    'one\ntwo\n===\n',
    '> <span>raw</span>\n',
    '> ---\n>\n> paragraph\n',
    '> - item\n',

    '# Hello *world* &amp; <em>tag</em>\n',
    '>\n> quote\n>\n> - nested\n',
    '- first\n\n- second\n\n  paragraph\n',
    '3. first\n4. second\n',
    '```go\n```\n\n```unknown\n<&>\n```\n',
    '    indented\n    code\n',
    'https://example.com test@example.com www.example.com\n',
    'a ~~deleted~~ b ~~two words~~\n',
    '[link](javascript:alert(1)) ![image](x.png "title")\n',
    'x[^a] twice[^a].\n\n[^a]: note\n',
    '---\n\n# Foo\n\n# Foo\n\n# Foo-1\n\n# !!!\n',
    '| A | B |\n|:--|--:|\n| x | y |\n',
    '> ```js\n> const x=1\n> ```\n',
    '- ```go\n  package main\n  ```\n',
    'heading\n=======\n\ntext  \nnext\n',
    'a \'quote\' & \"double\" <x>\n',
  ];
  for (const [i, source] of markdownCases.entries()) {
    const path = `parity-${i}.md`;
    await f.write(path, source);
    paths.push('api/markdown?' + new URLSearchParams({ path }));
  }
  const csvCases = [
    'a,b\n"a",',
    'a,b\n"a"x\ny,z\n',
    'a,b\n"a"\n',
    'a,b\n,,\n',
    'a,b\r\n\r\n1,2\r\n',
    '\ufeffa,b\n1,2\n',
    'a,b\n"a""b",c\n',
    'a,b\n"a\r\nb",c\n',
  ];
  for (const [i, source] of csvCases.entries()) {
    const path = `parity-${i}.csv`;
    await f.write(path, source);
    paths.push('api/table?' + new URLSearchParams({ path }));
  }
  for (const path of [
    'invalid.txt',
    'src/hello.go',
    'src/hello.ts',
    'src/hello.py',
    'empty.txt',
    'crlf.txt',
    'deleted.txt',
    'missing',
    'pixel.png',
    'binary.bin',
    'src',
    '',
  ])
    paths.push('api/file?' + new URLSearchParams({ path, raw: '1' }));
  for (const [start, count] of [
    ['9007199254740992', '1'],
    ['1', '9223372036854775807'],
    ['1', '18446744073709551616x'],
  ])
    paths.push(
      'api/file?' +
        new URLSearchParams({
          path: 'src/hello.go',
          start: start ?? '',
          count: count ?? '',
          raw: '1',
        }),
    );
  const outputs = [];
  for (const binary of [go, bun]) {
    const server = await launch(binary, f.root);
    try {
      await ready(server.baseUrl, server.started);
      const results = [];
      for (const path of paths) {
        const response = await fetch(new URL(path, server.baseUrl), {
          redirect: 'manual',
          headers: { 'Accept-Encoding': 'identity' },
        });
        const text = await response.text();
        const body = response.headers.get('content-type')?.includes('application/json')
          ? parse(text)
          : text;
        results.push(
          comparableHighlight(
            {
              path,
              status: response.status,
              contentType: response.headers.get('content-type'),
              disposition: response.headers.get('content-disposition'),
              location: response.headers.get('location'),
              body,
            },
            path,
          ),
        );
      }
      const bodies = [
        '',
        '{',
        '[]',
        '"x"',
        '2',
        'null',
        '{"path":2}',
        '{"path":{}}',
        '{"path":[]}',
        '{"Path":2}',
        '{"path":"requests/file.txt","Content":"😀"} ignored',
        '{"path":"requests/file.txt","Content":false}',
        '{"path":"requests/file.txt","Path":null}',
        '{"path":}',
        '{"path":"a",}',
        '{"path" "x"}',
      ];
      for (const route of ['api/file/save', 'api/fs/new'])
        for (const [i, body] of bodies.entries()) {
          const response = await fetch(new URL(route, server.baseUrl), { method: 'POST', body });
          const value: unknown = await response.json();
          results.push({ path: route + '#' + i, status: response.status, body: value });
        }
      await rm(join(f.root, 'requests'), { recursive: true, force: true });
      outputs.push(results);
    } finally {
      await server.stop();
    }
  }
  const reference = outputs[0] ?? [],
    candidate = outputs[1] ?? [];
  const mismatches = reference.flatMap((expected, i) =>
    isDeepStrictEqual(expected, candidate[i]) ? [] : [{ expected, actual: candidate[i] }],
  );
  await Bun.write('/tmp/faah-phase3-differential.json', JSON.stringify(mismatches, null, 2) + '\n');
  process.stdout.write(
    JSON.stringify({ baseCases, cases: reference.length, mismatches: mismatches.length }) + '\n',
  );
  if (mismatches.length)
    throw new Error('Go/Bun differential mismatches; see /tmp/faah-phase3-differential.json');
} finally {
  await f.cleanup();
}
