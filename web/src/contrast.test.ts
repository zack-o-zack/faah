import { required } from './lib/test-values.ts';
import { expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function luminance(hex: string): number {
  let value = hex.slice(1);
  if (value.length === 3) value = [...value].map((digit) => digit + digit).join('');
  return [0, 2, 4]
    .map((index) => parseInt(value.slice(index, index + 2), 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((sum, channel, index) => sum + channel * ([0.2126, 0.7152, 0.0722][index] || 0), 0);
}
function contrast(a: string, b: string): number {
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return ((high || 0) + 0.05) / ((low || 0) + 0.05);
}
const themeTokens = (file: string): Record<string, string> =>
  Object.fromEntries(
    [
      ...readFileSync(resolve('web/themes', file), 'utf8').matchAll(/--([\w-]+):\s*(#[\da-f]+);/gi),
    ].map((match) => [match[1] || '', match[2] || '']),
  );

const TEXT = ['foreground', 'muted-foreground', 'faint', 'primary-text', 'warn', 'destructive'];
const SYNTAX = [
  'gi',
  'gd',
  'k',
  'kt',
  'nf',
  'nc',
  'nb',
  'nv',
  'no',
  'na',
  'nt',
  'nd',
  'np',
  's',
  'm',
  'o',
  'p',
  'c',
  'cp',
];

for (const theme of ['catppuccin-mocha', 'light', 'dracula', 'solarized-light', 'github-dark']) {
  test(`${theme} keeps UI text, syntax and control edges legible on audited surfaces`, () => {
    const tokens = themeTokens(`${theme}.css`);
    for (const surface of ['background', 'sidebar', 'popover', 'accent']) {
      for (const text of [...TEXT, ...SYNTAX])
        expect(
          contrast(required(tokens[text]), required(tokens[surface])),
          `${theme}: ${text} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(required(tokens.input), required(tokens[surface])),
        `${theme}: input on ${surface}`,
      ).toBeGreaterThanOrEqual(3);
    }
    expect(
      contrast(required(tokens.primary), required(tokens['primary-foreground'])),
    ).toBeGreaterThanOrEqual(4.5);
  });
}

// Filled primary actions must be readable in every bundled theme, including
// the theme selected by an unseeded workbench detector session.
test('every bundled theme supplies accessible filled primary actions', () => {
  for (const file of readdirSync(resolve('web/themes')).filter((name) => name.endsWith('.css'))) {
    const tokens = themeTokens(file);
    expect(
      contrast(required(tokens.primary), required(tokens['primary-foreground'])),
      file,
    ).toBeGreaterThanOrEqual(4.5);
  }
});
