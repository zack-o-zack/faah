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
        results.push({
          path,
          status: response.status,
          contentType: response.headers.get('content-type'),
          disposition: response.headers.get('content-disposition'),
          location: response.headers.get('location'),
          body,
        });
      }
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
  await Bun.write('/tmp/faah-phase2-differential.json', JSON.stringify(mismatches, null, 2) + '\n');
  process.stdout.write(
    JSON.stringify({ cases: paths.length, mismatches: mismatches.length }) + '\n',
  );
  if (mismatches.length)
    throw new Error('Go/Bun differential mismatches; see /tmp/faah-phase2-differential.json');
} finally {
  await f.cleanup();
}
