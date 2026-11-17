import { expect, test } from 'vitest';
import { fileIcon } from './file-icon.ts';

test.each([
  ['icon-[ph--file-ts]', ['ts', 'mts', 'cts']],
  ['icon-[ph--file-tsx]', ['tsx']],
  ['icon-[ph--file-js]', ['js', 'mjs', 'cjs']],
  ['icon-[ph--file-jsx]', ['jsx']],
  ['icon-[ph--file-py]', ['py', 'pyi']],
  ['icon-[ph--file-rs]', ['rs']],
  ['icon-[ph--file-c]', ['c', 'h']],
  ['icon-[ph--file-cpp]', ['cpp', 'cc', 'cxx', 'hpp', 'hh']],
  ['icon-[ph--file-css]', ['css', 'scss', 'sass', 'less']],
  ['icon-[ph--file-html]', ['html', 'htm']],
  ['icon-[ph--file-md]', ['md', 'mdx', 'markdown']],
  ['icon-[ph--file-vue]', ['vue']],
  ['icon-[ph--file-sql]', ['sql']],
  ['icon-[ph--file-csv]', ['csv', 'tsv']],
  ['icon-[ph--file-svg]', ['svg']],
  ['icon-[ph--file-png]', ['png']],
  ['icon-[ph--file-jpg]', ['jpg', 'jpeg']],
  ['icon-[ph--file-image]', ['gif', 'webp', 'avif', 'ico', 'bmp', 'tiff']],
  ['icon-[ph--file-pdf]', ['pdf']],
  ['icon-[ph--file-zip]', ['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar']],
  ['icon-[ph--file-txt]', ['txt', 'log']],
  ['icon-[ph--file-doc]', ['doc', 'docx', 'rtf', 'odt']],
  ['icon-[ph--file-xls]', ['xls', 'xlsx', 'ods']],
  ['icon-[ph--file-ppt]', ['ppt', 'pptx', 'odp']],
  ['icon-[ph--file-ini]', ['ini', 'conf', 'cfg', 'toml', 'env']],
  ['icon-[ph--file-lock]', ['lock']],
  ['icon-[ph--file-audio]', ['mp3', 'wav', 'flac', 'ogg', 'm4a']],
  ['icon-[ph--file-video]', ['mp4', 'mov', 'webm', 'mkv', 'avi']],
  [
    'icon-[ph--file-code]',
    [
      'go',
      'rb',
      'java',
      'kt',
      'kts',
      'swift',
      'php',
      'sh',
      'bash',
      'zsh',
      'fish',
      'lua',
      'ex',
      'exs',
      'scala',
      'dart',
      'cs',
      'json',
      'jsonc',
      'yaml',
      'yml',
      'xml',
      'mod',
    ],
  ],
] as const)('%s covers its extensions regardless of case', (icon, extensions) => {
  for (const extension of extensions) {
    expect(fileIcon(`example.${extension}`)).toBe(icon);
    expect(fileIcon(`example.${extension.toUpperCase()}`)).toBe(icon);
  }
});

test.each([
  ['.env', 'icon-[ph--file-ini]'],
  ['.env.local', 'icon-[ph--file-ini]'],
  ['.env.production.json', 'icon-[ph--file-ini]'],
  ['.gitignore', 'icon-[ph--file-ini]'],
  ['.dockerignore', 'icon-[ph--file-ini]'],
  ['.editorconfig', 'icon-[ph--file-ini]'],
  ['.npmrc', 'icon-[ph--file-ini]'],
  ['go.sum', 'icon-[ph--file-lock]'],
  ['package-lock.json', 'icon-[ph--file-lock]'],
  ['bun.lockb', 'icon-[ph--file-lock]'],
  ['Dockerfile', 'icon-[ph--file-code]'],
  ['Makefile', 'icon-[ph--file-code]'],
])('special name %s takes precedence over its extension', (name, icon) => {
  expect(fileIcon(name)).toBe(icon);
  expect(fileIcon(name.toUpperCase())).toBe(icon);
});

test.each([
  ['a.test.ts', 'icon-[ph--file-ts]'],
  ['x.tar.gz', 'icon-[ph--file-zip]'],
  ['README', 'icon-[ph--file-text]'],
  ['file.', 'icon-[ph--file-text]'],
  ['file.unknown', 'icon-[ph--file-text]'],
  ['file.constructor', 'icon-[ph--file-text]'],
  ['.bashrc', 'icon-[ph--file-text]'],
  ['', 'icon-[ph--file-text]'],
])('%s uses the final extension or the default', (name, icon) => {
  expect(fileIcon(name)).toBe(icon);
});
