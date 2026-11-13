import { render, screen } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { markdownBlocks, safeMarkdownURL } from './markdown-model.ts';
import { Markdown } from './Markdown.jsx';
test('streaming Markdown preserves completed block identities', () => {
  const first = markdownBlocks('# Heading\n\nComplete paragraph.\n\nTail');
  const next = markdownBlocks('# Heading\n\nComplete paragraph.\n\nTail grows', first);
  expect(next[0]).toBe(first[0]);
  expect(next[1]).toBe(first[1]);
  expect(next[2]).not.toBe(first[2]);
});
test('Markdown renders checked citations and inert HTML without string-built markup', () => {
  const open = vi.fn();
  render(() => (
    <Markdown
      text={
        '**Answer** at `a.go:3` and `bad.go:99`.\n\n<script>bad()</script>\n\n[unsafe](javascript:alert)'
      }
      refs={{ 'a.go:3': { line: 7 } }}
      onOpen={open}
    />
  ));
  expect(screen.getByRole('button', { name: 'a.go:3' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'bad.go:99' })).toBeNull();
  expect(document.querySelector('script')).toBeNull();
  expect(safeMarkdownURL('javascript:alert(1)')).toBe('');
  expect(document.querySelector('a[href^="javascript"]')).toBeNull();
});
test('headings and completed paragraphs keep their DOM while a streamed tail grows', () => {
  const [text, setText] = createSignal('# Heading\n\nDone.\n\nTail');
  render(() => <Markdown text={text()} />);
  const heading = screen.getByRole('heading');
  setText('# Heading\n\nDone.\n\nTail grows');
  expect(screen.getByRole('heading')).toBe(heading);
  expect(screen.getByText('Tail grows')).toBeTruthy();
});
