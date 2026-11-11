import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const tokens = text => new Set(text.match(/--t-[\d-]+/g) || []);

test('every UI font size token is defined and mapped for the desktop app', () => {
  const style = read('style.css');
  const used = new Set([...tokens(style), ...tokens(read('workbench.css'))]);
  const defined = tokens(style.slice(style.indexOf(':root'), style.indexOf('}')));
  const desktop = tokens(read('desktop.css'));
  const mapped = tokens(read('tailwind.css'));
  for (const token of used) assert.ok(mapped.has(token), `${token} has no Tailwind mapping`);
  assert.ok(used.size > 0);
  for (const token of used) {
    assert.ok(defined.has(token), `${token} has no default in style.css`);
    assert.ok(desktop.has(token), `${token} has no desktop size in desktop.css`);
  }
});
