import { test, expect } from 'bun:test';
import { renderMarkdown } from '../src/markdown/service.ts';
import { plain } from '../src/render/html.ts';
const highlight = async (s: string, _lang: string, n: number) => plain(s, n);
test('Go Markdown heading ids, paragraphs, raw HTML, CRLF and code source markers', async () => {
  expect(
    await renderMarkdown(
      '# Header\r\n\r\nParagraph with **bold** and `code`.\r\n\r\n```go\r\nfunc main() {}\r\n```\r\n',
      highlight,
    ),
  ).toBe(
    '<h1 id="header" data-line="1">Header</h1>\n<p data-line="3">Paragraph with <strong>bold</strong> and <code>code</code>.</p>\n<pre class="md-code" data-line="6" data-lang="go"><code>func main() {}</code></pre>\n',
  );
  expect(
    await renderMarkdown('# Hello\n\n# Hello\n\n## 你好 😀\n\n<div>raw</div>\n', highlight),
  ).toBe(
    '<h1 id="hello" data-line="1">Hello</h1>\n<h1 id="hello-1" data-line="3">Hello</h1>\n<h2 id="你好-" data-line="5">你好 😀</h2>\n<div>raw</div>\n',
  );
});
test('Go task lists, tables, container markers and footnotes retain non-highlight HTML', async () => {
  const out = await renderMarkdown(
    '> quoted\n\n- [x] done\n- [ ] todo\n\nA | B\n--|--\nx | y\n\nFootnote[^a].\n\n[^a]: note\n',
    highlight,
  );
  expect(out).toContain('<blockquote data-line="1"><p data-line="1">quoted</p>\n</blockquote>');
  expect(out).toContain(
    '<li data-line="3"><input checked="" disabled="" type="checkbox"> done</li>',
  );
  expect(out).toContain('<table data-line="6">');
  expect(out).toContain(
    '<sup id="fnref:1"><a href="#fn:1" class="footnote-ref" role="doc-noteref">1</a></sup>',
  );
  expect(out).toContain('<div class="footnotes" role="doc-endnotes">\n<hr>\n<ol>');
});
