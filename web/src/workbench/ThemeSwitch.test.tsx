import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { expect, test, vi } from 'vitest';
import { ThemeSwitch } from './ThemeSwitch.tsx';

function mount(initial = '') {
  const changed = vi.fn();
  render(() => {
    const [value, setValue] = createSignal(initial);
    return (
      <ThemeSwitch
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

test('three named radios select System, Light and Dark preferences', () => {
  const changed = mount();
  expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeTruthy();
  expect(screen.getAllByRole('radio')).toHaveLength(3);
  for (const [name, value] of [
    ['Light', 'light'],
    ['Dark', 'dark'],
    ['System', ''],
  ]) {
    const radio = screen.getByRole('radio', { name });
    expect(radio.getAttribute('title')).toBe(name);
    fireEvent.click(radio);
    expect(changed).toHaveBeenLastCalledWith(value);
    expect(radio.getAttribute('aria-checked')).toBe('true');
    expect(screen.getAllByRole('radio').filter((item) => item.tabIndex === 0)).toEqual([radio]);
  }
});

test('arrows wrap and Home/End move selection and focus', () => {
  const changed = mount();
  for (const [from, key, to, value] of [
    ['System', 'ArrowRight', 'Light', 'light'],
    ['Light', 'ArrowDown', 'Dark', 'dark'],
    ['Dark', 'ArrowRight', 'System', ''],
    ['System', 'ArrowLeft', 'Dark', 'dark'],
    ['Dark', 'ArrowUp', 'Light', 'light'],
    ['Light', 'Home', 'System', ''],
    ['System', 'End', 'Dark', 'dark'],
  ]) {
    fireEvent.keyDown(screen.getByRole('radio', { name: from }), { key });
    const selected = screen.getByRole('radio', { name: to });
    expect(document.activeElement).toBe(selected);
    expect(selected.getAttribute('aria-checked')).toBe('true');
    expect(changed).toHaveBeenLastCalledWith(value);
  }
});

test('a user theme leaves all segments unchecked with one keyboard entry', () => {
  mount('custom');
  expect(
    screen.getAllByRole('radio').every((item) => item.getAttribute('aria-checked') === 'false'),
  ).toBe(true);
  expect(screen.getAllByRole('radio').filter((item) => item.tabIndex === 0)).toEqual([
    screen.getByRole('radio', { name: 'System' }),
  ]);
});
