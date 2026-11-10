const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isInternalURL, isExternalURL, workbenchURL } = require('./navigation.cjs');

test('only the owned backend origin can navigate inside the app', () => {
  const origin = 'http://127.0.0.1:54321';
  assert.equal(isInternalURL(`${origin}/w/123/?path=main.go`, origin), true);
  for (const url of ['http://127.0.0.1:7777/', 'http://localhost:54321/',
    'https://example.com', 'file:///etc/passwd', 'javascript:alert(1)',
    'http://user:pass@127.0.0.1:54321/', 'about:blank', '/w/123/']) {
    assert.equal(isInternalURL(url, origin), false, url);
  }
});

test('external navigation only accepts web links without credentials', () => {
  assert.equal(isExternalURL('https://github.com/owner/repo/pull/1'), true);
  assert.equal(isExternalURL('http://forge.local/repo'), true);
  for (const url of ['file:///tmp/script', 'javascript:alert(1)', 'data:text/html,hi',
    'vscode://file/tmp', 'https://token@example.com', 'about:blank', 'not a url']) {
    assert.equal(isExternalURL(url), false, url);
  }
});

test('workspace paths are encoded as a query, including spaces and URL delimiters', () => {
  const origin = 'http://127.0.0.1:54321';
  const target = '/Users/someone/code with spaces & #hash';
  const url = new URL(workbenchURL(origin, target));
  assert.equal(url.origin, origin);
  assert.equal(url.pathname, '/');
  assert.equal(url.searchParams.get('open'), target);
  assert.equal(url.hash, '');
  assert.equal(workbenchURL(origin), origin + '/');
});
