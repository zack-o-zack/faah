import { suite, capture } from './harness.ts';
const s = suite('static', '/contract/');
s.case('index', '');
s.case('base-redirect', '/contract');
s.case('root-redirect', '/');
s.case('unknown-page', 'missing');
s.case('unknown-api', 'api/no-such-route');
s.case('missing-asset', 'static/not-present.js');
s.case('traversal-asset', '/contract/static/%2e%2e/%2e%2e/go.mod');
for (const gzip of [false, true]) {
  const suffix = gzip ? 'gzip' : 'identity';
  const headers = { 'Accept-Encoding': gzip ? 'gzip' : 'identity' };
  s.case(`themes-${suffix}`, 'static/themes.css', { headers });
  s.case(`asset-${suffix}`, 'static/app.js', { headers, hash: true });
  s.case(`meta-${suffix}`, 'api/meta', { headers });
}
s.run('decoded-bodies-match', async (c) => {
  const { request } = await import('./transport.ts');
  const { expect } = await import('bun:test');
  for (const path of [
    'static/app.js',
    'static/themes.css',
    'api/tree',
    'api/markdown?path=README.md',
    'api/raw?path=crlf.txt',
    'api/raw?path=binary.bin',
  ]) {
    const plain = await request(c.server.baseUrl, path, { hash: true });
    const compressed = await request(c.server.baseUrl, path, {
      hash: true,
      headers: { 'Accept-Encoding': 'gzip' },
    });
    expect(compressed.body).toEqual(plain.body);
  }
  await capture(c, 'static', 'index-post', '', { method: 'POST' });
});
