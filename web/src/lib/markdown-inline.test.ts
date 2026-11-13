import { expect, test } from 'vitest';
import { inlineMarkdown } from './markdown-model.ts';
test('optional regex groups distinguish images, links and emphasis', () => {
  expect(inlineMarkdown('![alt](a.png)')).toEqual([{ type: 'image', text: 'alt', url: 'a.png' }]);
  expect(inlineMarkdown('![](a.png)')).toEqual([{ type: 'image', text: '', url: 'a.png' }]);
  expect(inlineMarkdown('[label](a.go:3)')).toEqual([
    { type: 'link', url: 'a.go:3', children: [{ type: 'text', text: 'label' }] },
  ]);
  expect(inlineMarkdown('**bold**')).toEqual([
    { type: 'strong', children: [{ type: 'text', text: 'bold' }] },
  ]);
  expect(inlineMarkdown('_em_')).toEqual([
    { type: 'em', children: [{ type: 'text', text: 'em' }] },
  ]);
  expect(inlineMarkdown('https://example.com')).toEqual([
    {
      type: 'link',
      url: 'https://example.com',
      children: [{ type: 'text', text: 'https://example.com' }],
    },
  ]);
});
