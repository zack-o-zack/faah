import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { expect, test, vi } from 'vitest';
import { ThemeToggle } from './ThemeToggle.tsx';

function mount(initial = '') {
  const changed = vi.fn();
  render(() => {
    const [value, setValue] = createSignal(initial);
    return (
      <ThemeToggle
        value={value()}
        onChange={(id) => {
          changed(id);
          setValue(id);
        }}
      />
    );
  });
  return changed;
}

test('one button names the current mode and cycles to the next', () => {
  const changed = mount();
  const button = screen.getByRole('button', { name: 'Theme: System. Switch to Light' });
  expect(button.getAttribute('title')).toBe('Theme: System. Switch to Light');
  expect(button.dataset.variant).toBe('ghost');
  expect(button.querySelector('.icon-\\[ph--monitor\\]')).toBeTruthy();

  fireEvent.click(button);
  expect(changed).toHaveBeenLastCalledWith('light');
  expect(screen.getByTitle('Theme: Light. Switch to Dark')).toBeTruthy();
  expect(screen.getByRole('button').querySelector('.icon-\\[ph--sun\\]')).toBeTruthy();

  fireEvent.click(screen.getByRole('button'));
  expect(changed).toHaveBeenLastCalledWith('dark');
  expect(screen.getByRole('button').querySelector('.icon-\\[ph--moon\\]')).toBeTruthy();

  fireEvent.click(screen.getByRole('button'));
  expect(changed).toHaveBeenLastCalledWith('');
  expect(screen.getByRole('button', { name: 'Theme: System. Switch to Light' })).toBeTruthy();
});
