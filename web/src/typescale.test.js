import { URL } from 'node:url';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL(`file://${process.cwd()}/`);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const tokens = text => new Set(text.match(/--t-[\d-]+/g) || []);
const declarations = text => new Set([...text.matchAll(/(--t-[\d-]+):\s*[\d.]+px\s*;/g)].map(match => match[1]));

const sources = [
  'web/tailwind.css', 'web/index.html', 'web/workbench.html',
  ...fs.readdirSync(root).filter(path => path.endsWith('.go')),
  ...['web/src/', 'web/themes/', 'internal/', 'desktop/'].flatMap(directory =>
    fs.readdirSync(new URL(directory, root), { recursive: true })
      .filter(path => /\.(?:js|cjs|go|css)$/.test(path) && !path.includes('node_modules/'))
      .map(path => directory + path)),
];

test('every used type token has a browser size, desktop size and Tailwind mapping', () => {
  const stylesheet = read('web/tailwind.css');
  const used = new Set(sources.flatMap(path => [...tokens(read(path))]));
  const defined = declarations(stylesheet.match(/:root\s*\{([^}]+)\}/)?.[1] || '');
  const desktop = declarations(stylesheet.match(/:root\[data-shell\]\s*\{([^}]+)\}/)?.[1] || '');
  const mapped = tokens(stylesheet.match(/@theme inline\s*\{([^}]+)\}/)?.[1] || '');
  assert.ok(used.size > 0);
  for (const token of used) {
    assert.ok(defined.has(token), token + ' has no default size in :root');
    assert.ok(desktop.has(token), token + ' has no desktop size in :root[data-shell]');
    assert.ok(mapped.has(token), token + ' has no Tailwind mapping');
  }
});

test('the Tailwind entry is the only stylesheet source and uses theme colours', () => {
  const stylesheets = fs.readdirSync(new URL('web/', root)).filter(path => path.endsWith('.css') && path !== 'app.css');
  assert.deepEqual(stylesheets, ['tailwind.css']);
  assert.doesNotMatch(read('web/tailwind.css'), /#[0-9a-fA-F]{3,8}\b|rgba?\(|oklch\(/);
});
