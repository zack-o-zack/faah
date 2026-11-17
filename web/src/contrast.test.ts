import { required } from './lib/test-values.ts';
import { expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Color = readonly [number, number, number, number];
function parseColor(value: string): Color {
  if (value.startsWith('#')) {
    let hex = value.slice(1);
    if (hex.length === 3) hex = [...hex].map((digit) => digit + digit).join('');
    if (!/^[\da-f]{6}$/i.test(hex)) throw new Error('Invalid hex: ' + value);
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      1,
    ];
  }
  const match = value.match(/^rgba?\(([^)]+)\)$/);
  if (!match) throw new Error('Unsupported colour: ' + value);
  const channels = required(match[1]).split(',').map(Number);
  return [required(channels[0]), required(channels[1]), required(channels[2]), channels[3] ?? 1];
}
function composite(front: Color, back: Color): Color {
  const channel = (index: 0 | 1 | 2) => front[index] * front[3] + back[index] * (1 - front[3]);
  return [channel(0), channel(1), channel(2), 1];
}
function luminance(color: Color): number {
  return color
    .slice(0, 3)
    .map((value) => value / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
    .reduce((sum, value, index) => sum + value * required([0.2126, 0.7152, 0.0722][index]), 0);
}
function contrast(a: Color, b: Color): number {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function themeTokens(file: string): (name: string) => Color {
  const tokens = new Map(
    [...readFileSync(resolve('web/themes', file), 'utf8').matchAll(/--([\w-]+):\s*([^;]+);/g)].map(
      (match) => [required(match[1]), required(match[2]).trim()],
    ),
  );
  const resolveToken = (name: string, seen: readonly string[] = []): Color => {
    if (seen.includes(name)) throw new Error('Circular theme token: ' + name);
    const value = required(tokens.get(name));
    const alias = value.match(/^var\(--([\w-]+)\)$/);
    return alias ? resolveToken(required(alias[1]), [...seen, name]) : parseColor(value);
  };
  return resolveToken;
}
const TEXT = [
  'foreground',
  'muted-foreground',
  'faint',
  'primary-text',
  'warn',
  'destructive',
  'special',
  'err',
  'gi',
  'gd',
];
const SYNTAX = [
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
  'err',
];
const SURFACES = ['surface', 'surface-raised', 'surface-sunken', 'cur'];
const PASTELS = ['pistachio', 'periwinkle', 'aqua', 'lemon', 'bubblegum'];

test('the bundled theme set is exactly fibo light and dark', () => {
  expect(
    readdirSync(resolve('web/themes'))
      .filter((file) => file.endsWith('.css'))
      .sort(),
  ).toEqual(['fibo-dark.css', 'fibo-light.css']);
});
for (const theme of ['fibo-light', 'fibo-dark']) {
  test(`${theme} keeps text, syntax, diff ink and focus legible`, () => {
    const token = themeTokens(theme + '.css');
    const assertContrast = (name: string, background: Color, label: string, minimum = 4.5) => {
      expect(
        contrast(token(name), background),
        `${theme}: ${name} on ${label}`,
      ).toBeGreaterThanOrEqual(minimum);
    };
    for (const surface of SURFACES) {
      for (const text of [...TEXT, ...SYNTAX]) assertContrast(text, token(surface), surface);
      assertContrast('focus', token(surface), surface, 3);
      assertContrast('input', token(surface), surface, 3);
    }
    // Selection can sit on the current row as well as the editor surface.
    for (const surface of ['surface', 'cur']) {
      const background = composite(token('sel'), token(surface));
      for (const text of ['ink', 'foreground', ...SYNTAX]) {
        assertContrast(text, background, `sel over ${surface}`);
      }
    }
    // Alpha fills are composited, never treated as opaque RGB.
    for (const fill of ['gi-bg', 'gd-bg']) {
      const background = composite(token(fill), token('surface'));
      for (const text of ['foreground', ...SYNTAX]) assertContrast(text, background, fill);
      const wordBackground = composite(token(fill), background);
      for (const text of ['foreground', ...SYNTAX]) {
        assertContrast(text, wordBackground, `${fill} word highlight over diff row`);
      }
      if (fill === 'gi-bg') assertContrast('gi', background, fill);
      if (fill === 'gd-bg') assertContrast('gd', background, fill);
    }
    for (const pastel of PASTELS) assertContrast('on-pastel', token(pastel), pastel);
    assertContrast('on-mark-active', token('mark-active'), 'mark-active');
    assertContrast('primary-foreground', token('primary'), 'primary');
  });
}
