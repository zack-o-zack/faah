import { expect, test } from 'vitest';
import { selectionRef, contextSnippet } from './selection.js';

test('references and context snippets preserve single lines and ranges', () => {
  const info = { path: 'src/file.go', l1: 2, l2: 2, text: 'source' };
  expect(selectionRef(info)).toBe('src/file.go:2');
  expect(selectionRef({ ...info, l2: 4 })).toBe('src/file.go:2-4');
  expect(contextSnippet(info)).toBe('@src/file.go line 2\n```go\nsource\n```');
  expect(contextSnippet({ ...info, l2: 4 })).toContain('lines 2-4');
});
