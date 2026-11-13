import { afterEach, expect, test, vi } from 'vitest';
import { copyText } from './clipboard.ts';

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const commandDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand');
afterEach(() => {
  vi.restoreAllMocks();
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else Reflect.deleteProperty(navigator, 'clipboard');
  if (commandDescriptor) Object.defineProperty(document, 'execCommand', commandDescriptor);
  else Reflect.deleteProperty(document, 'execCommand');
});

test('copies through the secure clipboard API when available', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  expect(await copyText('source')).toBe(true);
  expect(writeText).toHaveBeenCalledWith('source');
});

test('falls back on plain HTTP and restores focus and selection', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  const copy = vi.fn(() => true);
  Object.defineProperty(document, 'execCommand', { configurable: true, value: copy });
  const button = document.createElement('button');
  const source = document.createElement('span');
  source.textContent = 'selected source';
  document.body.append(button, source);
  button.focus();
  const range = document.createRange();
  range.selectNodeContents(source);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
  expect(await copyText('selected source')).toBe(true);
  expect(copy).toHaveBeenCalledWith('copy');
  expect(document.activeElement).toBe(button);
  expect(document.getSelection()?.toString()).toBe('selected source');
  expect(document.querySelector('textarea')).toBeNull();
  button.remove();
  source.remove();
});

test('reports failure when both clipboard methods fail', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) },
  });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
  expect(await copyText('source')).toBe(false);
});
