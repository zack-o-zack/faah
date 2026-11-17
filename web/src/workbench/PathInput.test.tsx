import { required } from '../lib/test-values.ts';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { WorkbenchProvider } from './context.tsx';
import { PathInput } from './PathInput.tsx';

test('arrows select, Tab enters, Enter submits the selection and Escape closes', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    Response.json({
      entries: [
        { name: 'config', path: '/code/config/' },
        { name: 'core', path: '/code/core/', git: true },
      ],
    }),
  );
  const folder = vi.fn();
  const submit = vi.fn();
  render(() => {
    const [value, setValue] = createSignal('/code/c');
    return (
      <WorkbenchProvider>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(value());
          }}
        >
          <PathInput value={value()} onInput={setValue} onFolder={folder} label="Workspace path" />
          <button type="submit">Open folder</button>
        </form>
      </WorkbenchProvider>
    );
  });
  const input = screen.getByRole('combobox', { name: 'Workspace path' });
  const user = userEvent.setup();
  await user.click(input);
  expect(await screen.findAllByRole('option')).toHaveLength(2);
  await user.keyboard('{ArrowDown}{ArrowDown}');
  expect(required(screen.getAllByRole('option')[1]).getAttribute('aria-selected')).toBe('true');
  await user.keyboard('{ArrowUp}');
  expect(required(screen.getAllByRole('option')[0]).getAttribute('aria-selected')).toBe('true');
  await user.keyboard('{Tab}');
  expect(input).toHaveProperty('value', '/code/config/');
  expect(folder).toHaveBeenCalledExactlyOnceWith('/code/config/');
  expect(submit).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(input);

  await user.clear(input);
  await user.type(input, '/code/c');
  expect(await screen.findAllByRole('option')).toHaveLength(2);
  await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
  expect(input).toHaveProperty('value', '/code/core/');
  expect(submit).toHaveBeenCalledExactlyOnceWith('/code/core/');
  expect(folder).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('listbox')).toBeNull();

  fireEvent.blur(input);
  fireEvent.focus(input);
  expect(await screen.findAllByRole('option')).toHaveLength(2);
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true);
});

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
