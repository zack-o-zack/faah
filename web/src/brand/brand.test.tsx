import fs from 'node:fs';
import { render, screen } from '@solidjs/testing-library';
import { expect, test } from 'vitest';
import { required } from '../lib/test-values.ts';
import { Brand } from './Brand.tsx';
import { Mark } from './Mark.tsx';

test('the decorative mark preserves the source geometry and static state', () => {
  const { container } = render(() => <Mark />);
  const svg = required(container.querySelector('svg'));
  const source = new DOMParser().parseFromString(
    fs.readFileSync('web/mark.svg', 'utf8'),
    'image/svg+xml',
  );
  expect(svg.getAttribute('viewBox')).toBe('0 0 74.5 55.7');
  expect(svg.querySelectorAll('path')).toHaveLength(1);
  expect(required(svg.querySelector('path')).getAttribute('d')).toBe(
    required(source.querySelector('path')).getAttribute('d'),
  );
  expect(svg.getAttribute('fill')).toBe('none');
  expect(svg.getAttribute('stroke')).toBe('currentColor');
  expect(svg.getAttribute('stroke-width')).toBe('7.5');
  expect(svg.getAttribute('stroke-linecap')).toBe('round');
  expect(svg.getAttribute('stroke-linejoin')).toBe('round');
  expect(svg.classList.contains('text-[var(--spiral)]')).toBe(true);
  expect(svg.getAttribute('width')).toBe('22');
  expect(svg.getAttribute('data-state')).toBe('static');
  expect(svg.getAttribute('aria-hidden')).toBe('true');
  expect(svg.hasAttribute('aria-label')).toBe(false);
  expect(screen.queryByRole('img')).toBeNull();
});

test('a labeled mark is an image with the requested width', () => {
  render(() => <Mark label="fibo" size={18} state="static" />);
  const svg = screen.getByRole('img', { name: 'fibo' });
  expect(svg.hasAttribute('aria-hidden')).toBe(false);
  expect(svg.getAttribute('width')).toBe('18');
  expect(svg.getAttribute('height')).toBe(String((18 * 55.7) / 74.5));
  expect(svg.getAttribute('data-state')).toBe('static');
});

test.each(['chrome', 'welcome'] as const)('the %s lockup has one accessible name', (size) => {
  render(() => <Brand size={size} />);
  const brand = screen.getByRole('img', { name: 'fibo' });
  expect(screen.getAllByRole('img')).toHaveLength(1);
  expect(required(brand.querySelector('svg')).getAttribute('aria-hidden')).toBe('true');
  expect(required(brand.querySelector('svg')).getAttribute('width')).toBe(
    size === 'welcome' ? '56' : '18',
  );
  expect(screen.getByText('fibo').getAttribute('aria-hidden')).toBe('true');
  expect(screen.getByText('fibo').classList.contains('font-display')).toBe(true);
});
