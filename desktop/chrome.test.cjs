const assert = require('node:assert/strict');
const test = require('node:test');
const { chromeOptions, chromeColors, menuPoint } = require('./chrome.cjs');

test('each platform gets its own window frame', () => {
  assert.equal(chromeOptions('darwin').titleBarStyle, 'hiddenInset');
  assert.equal(chromeOptions('win32').titleBarStyle, 'hidden');
  assert.ok(chromeOptions('win32').titleBarOverlay);
  assert.deepEqual(chromeOptions('linux'), {});
});

test('only plain hex theme colors reach the native window', () => {
  assert.deepEqual(chromeColors({ color: '#16161e', symbolColor: '#fff', extra: 1 }),
    { color: '#16161e', symbolColor: '#fff' });
  assert.equal(chromeColors({ color: 'url(x)', symbolColor: '#fff' }), null);
  assert.equal(chromeColors({ color: '#16161e' }), null);
  assert.equal(chromeColors(undefined), null);
});

test('menu position must be numeric', () => {
  assert.deepEqual(menuPoint({ x: 10.4, y: 38 }), { x: 10, y: 38 });
  assert.equal(menuPoint({ x: '10', y: 38 }), null);
  assert.equal(menuPoint(null), null);
});
