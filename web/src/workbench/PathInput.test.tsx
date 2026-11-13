import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { expect, test, vi } from 'vitest';
import { WorkbenchProvider } from './context.tsx';
import { PathInput } from './PathInput.tsx';

test('clearing a path or entering a URL hides retained completions and does not intercept Tab', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ entries: [{ name: 'repo', path: '/code/repo', dir: true }] }),
  );
  render(() => {
    const [value, setValue] = createSignal('/code/r');
    return (
      <WorkbenchProvider>
        <PathInput value={value()} onInput={setValue} label="Workspace path" />
      </WorkbenchProvider>
    );
  });
  const input = screen.getByRole('combobox', { name: 'Workspace path' });
  fireEvent.focus(input);
  expect(await screen.findByRole('option')).toBeTruthy();
  fireEvent.input(input, { target: { value: '' } });
  expect(screen.queryByRole('option')).toBeNull();
  expect(input.getAttribute('aria-expanded')).toBe('false');
  expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true);
  expect(input).toHaveProperty('value', '');

  fireEvent.input(input, { target: { value: '/code/r' } });
  expect(await screen.findByRole('option')).toBeTruthy();
  fireEvent.input(input, { target: { value: 'https://host/repo/pull/1' } });
  expect(screen.queryByRole('option')).toBeNull();
  expect(input.getAttribute('aria-expanded')).toBe('false');
  expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true);
  expect(input).toHaveProperty('value', 'https://host/repo/pull/1');
});
