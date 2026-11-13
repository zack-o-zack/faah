import { test, expect } from 'vitest';
import { normalizeURL } from './markdown-logic.js';
import {
  brokenImageCard,
  sanitizeDocument,
  syncMarkdownPictures,
  domToMarkdown,
  getFragmentHtml,
  getFragmentPlainText,
} from './markdown-dom.js';
test('URL normalization strips parser controls without changing spaces inside file paths', () => {
  expect(normalizeURL('\u0000 javascript:\talert(1)\r\n ')).toBe('javascript:alert(1)');
  expect(normalizeURL(' diagrams/my picture.png ')).toBe('diagrams/my picture.png');
});
test('sanitizer drops active content, prefixed IDs and unsafe schemes', () => {
  const fragment = sanitizeDocument(
    '<h1 id="status" onclick="x()">Title</h1><script>bad</script><iframe src="x"></iframe><a href="java&#9;script:bad()">bad</a><input type="checkbox" checked><input type="text"><svg onload="x()"></svg>',
    'docs/readme.md',
  );
  expect(fragment.querySelector('h1').id).toBe('md-status');
  expect(fragment.querySelector('h1').hasAttribute('onclick')).toBe(false);
  expect(fragment.querySelector('a').hasAttribute('href')).toBe(false);
  expect(fragment.querySelectorAll('script, iframe, svg, input[type=text]')).toHaveLength(0);
  expect(fragment.querySelector('input').disabled).toBe(true);
});
test('workspace links, raw images and external links retain their intended targets', () => {
  const fragment = sanitizeDocument(
    '<a href="../file.go#L20">source</a><a href="https://example.com">external</a><img src="my picture.png" alt="diagram">',
    'docs/readme.md',
  );
  expect(fragment.querySelector('a').dataset).toMatchObject({ path: 'file.go', anchor: 'L20' });
  expect(fragment.querySelectorAll('a')[1].rel).toBe('noopener noreferrer');
  expect(fragment.querySelector('img').dataset.rawPath).toBe('docs/my picture.png');
});
test('picture sources follow the app scheme rather than system media queries', () => {
  const fragment = sanitizeDocument(
    '<picture><source media="(prefers-color-scheme: dark)" srcset="dark.png"><source media="(prefers-color-scheme: light)" srcset="light.png"><img src="fallback.png"></picture>',
    'docs/readme.md',
  );
  syncMarkdownPictures(fragment, 'dark');
  expect(fragment.querySelector('img').dataset.picturePath).toBe('docs/dark.png');
  expect(fragment.querySelector('source').media).toBe('(min-width: 0px)');
});
test('selection serialization preserves source code, links and tables but excludes chrome', () => {
  const fragment = sanitizeDocument(
    '<h2>Title</h2><p><strong>bold</strong> <a href="next.md">next</a></p><pre data-lang="js"><code>const n = 1;</code></pre><table><tr><th>Name</th></tr><tr><td>Value</td></tr></table>',
    'docs/readme.md',
  );
  const raw = domToMarkdown(fragment);
  expect(raw).toContain('## Title');
  expect(raw).toContain('```js\nconst n = 1;\n```');
  expect(raw).toContain('| Name |');
  expect(getFragmentPlainText(fragment)).toContain('bold next');
  expect(getFragmentHtml(fragment)).toContain('<strong>bold</strong>');
});

test('a missing Markdown image becomes a card naming its path', () => {
  const img = document.createElement('img');
  img.dataset.rawPath = 'docs/missing.png';
  const card = brokenImageCard(img);
  expect(card.className).toBe('md-img-broken');
  expect(card.textContent).toBe('Image not found: docs/missing.png');
  expect(card.firstElementChild.getAttribute('aria-hidden')).toBe('true');
});
