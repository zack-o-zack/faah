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
function themeTokens(file: string, dir = 'web/themes'): (name: string) => Color {
  const tokens = new Map(
    [...readFileSync(resolve(dir, file), 'utf8').matchAll(/--([\w-]+):\s*([^;]+);/g)].map(
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
  'link',
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
test('themes define only the supported neutral color contract', () => {
  const contract = [
    'theme-name surface surface-raised surface-sunken ink ink-muted line line-strong',
    'on-spiral spiral state-open state-merged state-closed state-draft on-state',
    'danger danger-soft focus hover background foreground',
    'card card-foreground popover popover-foreground primary primary-foreground secondary secondary-foreground',
    'muted muted-foreground accent accent-foreground border input ring sidebar',
    'sidebar-foreground sidebar-primary sidebar-primary-foreground sidebar-accent sidebar-accent-foreground sidebar-border sidebar-ring image-dark',
    'image-light faint primary-text link special cur sel mark mark-active',
    'on-mark-active warn gi gi-bg gi-word gd gd-bg gd-word',
    'destructive destructive-foreground err shadow-raise shadow-pop shadow-dialog k kt',
    'nf nc nb nv no na nt nd',
    'np s m o p c cp',
  ]
    .flatMap((group) => group.split(' '))
    .sort();
  for (const file of readdirSync(resolve('web/themes')).filter((file) => file.endsWith('.css'))) {
    const definitions = [
      ...readFileSync(resolve('web/themes', file), 'utf8').matchAll(/--([\w-]+):/g),
    ]
      .map((match) => match[1])
      .sort();
    expect(definitions).toEqual(contract);
  }
});

test('the bundled theme set is exactly Light and Dark', () => {
  expect(
    readdirSync(resolve('web/themes'))
      .filter((file) => file.endsWith('.css'))
      .sort(),
  ).toEqual(['dark.css', 'light.css']);
});
for (const theme of ['light', 'dark']) {
  for (const fill of ['gi-bg', 'gd-bg', 'gi-word', 'gd-word']) {
    test(`${theme} keeps ink and every syntax token legible on ${fill}`, () => {
      const token = themeTokens(theme + '.css');
      const background = token(fill);
      expect(background[3], `${theme}: ${fill} is opaque`).toBe(1);
      for (const text of ['ink', 'foreground', ...SYNTAX]) {
        expect(
          contrast(token(text), background),
          `${theme}: ${text} on ${fill}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
    test(`${theme} keeps ${fill} visible against the surface`, () => {
      const token = themeTokens(theme + '.css');
      // The approved dark deletion fill is 1.09788:1, approximately 1.10:1.
      expect(contrast(token(fill), token('surface'))).toBeGreaterThanOrEqual(
        fill.endsWith('-word') ? 1.3 : 1.09,
      );
    });
  }
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
    for (const fill of ['gi-bg', 'gd-bg']) {
      assertContrast(fill === 'gi-bg' ? 'gi' : 'gd', token(fill), fill);
    }
    assertContrast('on-spiral', token('spiral'), 'spiral');
    for (const state of ['state-open', 'state-merged', 'state-closed', 'state-draft']) {
      assertContrast('on-state', token(state), state);
    }
    assertContrast('on-mark-active', token('mark-active'), 'mark-active');
    assertContrast('primary-foreground', token('primary'), 'primary');
  });
}

// Read the shipping values so a CSS change cannot silently bypass contrast coverage.
const glassCSS = readFileSync(resolve('web/tailwind.css'), 'utf8');
const glassAlpha = (pattern: RegExp) => Number(required(glassCSS.match(pattern)?.[1])) / 100;
const subtleAlpha = glassAlpha(/:root \{[^}]*--glass-alpha:\s*([\d.]+)%/);
const strongAlpha = glassAlpha(
  /:root\[data-transparency='strong'\][^{]*\{[^}]*--glass-alpha:\s*([\d.]+)%/,
);
// The blur averages what is behind a layer. The worst realistic backdrop is a dense
// block of text: half foreground, half background. A plain background is checked too.
const backdrops = (token: (name: string) => Color): Color[] => {
  const [b, f] = [token('background'), token('foreground')];
  const half = (i: 0 | 1 | 2) => (b[i] + f[i]) / 2;
  return [b, [half(0), half(1), half(2), 1]];
};
test('strong glass is more see-through than subtle', () => {
  expect(strongAlpha).toBeLessThan(subtleAlpha);
});
for (const theme of ['light', 'dark']) {
  test(`${theme} glass keeps normal and muted ink legible at every level`, () => {
    const token = themeTokens(theme + '.css');
    const fill = token('popover');
    for (const alpha of [subtleAlpha, strongAlpha]) {
      for (const backdrop of backdrops(token)) {
        const background = composite([fill[0], fill[1], fill[2], alpha], backdrop);
        for (const text of ['foreground', 'ink', 'muted-foreground']) {
          expect(contrast(token(text), background), `${text} at ${alpha}`).toBeGreaterThanOrEqual(
            4.5,
          );
        }
      }
    }
  });
}

// Code themes paint code surfaces only, so they carry the smaller token set.
const CODE_CONTRACT = [
  'theme-name background foreground muted-foreground faint border',
  'sel cur mark mark-active on-mark-active',
  'gi gd gi-bg gd-bg gi-word gd-word err warn',
  'k kt nf nc nb nv no na nt nd np s m o p c cp',
]
  .flatMap((group) => group.split(' '))
  .sort();
const codeThemeFiles = readdirSync(resolve('web/code-themes'))
  .filter((file) => file.endsWith('.css'))
  .sort();

test('the bundled code theme set is the approved list', () => {
  expect(codeThemeFiles).toEqual([
    'catppuccin-latte.css',
    'catppuccin-mocha.css',
    'classic-dark.css',
    'classic-light.css',
    'dracula.css',
    'gruvbox-dark.css',
    'gruvbox-light.css',
    'midnight.css',
    'monokai.css',
    'nord.css',
    'one-dark.css',
    'rose-pine.css',
    'solarized-dark.css',
    'solarized-light.css',
  ]);
});

test('code themes define only the tokens code surfaces read', () => {
  for (const file of codeThemeFiles) {
    const definitions = [
      ...readFileSync(resolve('web/code-themes', file), 'utf8').matchAll(/--([\w-]+):/g),
    ]
      .map((match) => required(match[1]))
      .sort();
    expect(definitions, file).toEqual(CODE_CONTRACT);
  }
});

for (const file of codeThemeFiles) {
  const id = file.replace(/\.css$/, '');
  test(`${id} keeps ink and every syntax token legible on its own surfaces`, () => {
    const token = themeTokens(file, 'web/code-themes');
    const background = token('background');
    const surfaces: [string, Color][] = [
      ['background', background],
      ['cur', token('cur')],
      ['sel over background', composite(token('sel'), background)],
      ['sel over current line', composite(token('sel'), token('cur'))],
      ['gi-bg', composite(token('gi-bg'), background)],
      ['gd-bg', composite(token('gd-bg'), background)],
    ];
    for (const [label, surface] of surfaces) {
      for (const name of ['foreground', ...SYNTAX]) {
        expect(contrast(token(name), surface), `${id}: ${name} on ${label}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
    expect(
      contrast(token('on-mark-active'), token('mark-active')),
      `${id}: on-mark-active on mark-active`,
    ).toBeGreaterThanOrEqual(4.5);
  });
  test(`${id} keeps its diff fills visible against the background`, () => {
    const token = themeTokens(file, 'web/code-themes');
    const background = token('background');
    for (const fill of ['gi-bg', 'gd-bg', 'gi-word', 'gd-word']) {
      const paint = fill.endsWith('-bg') ? composite(token(fill), background) : token(fill);
      expect(contrast(paint, background), `${id}: ${fill}`).toBeGreaterThanOrEqual(
        fill.endsWith('-word') ? 1.3 : 1.09,
      );
    }
  });
}
