import { test, expect } from 'vitest';
import { pictureSource } from './markdown-picture.ts';

test('picture sources accept safe single image references and explicit color schemes', () => {
  expect(pictureSource('web/logo-light.svg', '(prefers-color-scheme: light)')).toEqual({
    src: 'web/logo-light.svg',
    scheme: 'light',
  });
  expect(pictureSource('https://example.org/logo.svg', '(prefers-color-scheme: dark)')).toEqual({
    src: 'https://example.org/logo.svg',
    scheme: 'dark',
  });
  for (const src of [
    'javascript:alert(1)',
    'java\nscript:alert(1)',
    'data:image/svg+xml,evil',
    'file:///secret',
    'one.svg,https://example.org/two.svg',
    'one.svg 2x',
    '',
  ]) {
    expect(pictureSource(src, '(prefers-color-scheme: light)')).toBeNull();
  }
  expect(pictureSource('one.svg', '(min-width: 1px)')).toBeNull();
});
