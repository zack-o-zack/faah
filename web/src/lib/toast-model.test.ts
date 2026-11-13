import { expect, test } from 'vitest';
import { toastConfig } from './toast-model.ts';

test('toast kinds pick an icon and show the text as the title', () => {
  const config = toastConfig('success', 'Saved');
  expect(config.category).toBe('success');
  expect(config.icon).toContain('icon-[lucide--circle-check]');
  expect(config.title).toBe('Saved');
  expect(toastConfig('error', 'Failed').icon).toContain('icon-[lucide--circle-alert]');
});

test('any other first argument becomes a heading over the text', () => {
  expect(toastConfig('Pushed', 'main is up to date')).toEqual({
    category: '',
    title: 'Pushed',
    description: 'main is up to date',
  });
  expect(toastConfig('', 'Ready', 1000)).toEqual({ category: '', title: 'Ready', duration: 1000 });
});
