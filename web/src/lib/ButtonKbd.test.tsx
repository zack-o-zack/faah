import { render, screen } from '@solidjs/testing-library';
import { expect, test } from 'vitest';
import { ButtonKbd } from './ButtonKbd.tsx';
import { keyLabel } from './keyboard.ts';

test('button shortcuts use the platform label and remain hidden from the accessible action name', () => {
  render(() => (
    <button title="Send (Enter)" aria-keyshortcuts="Enter">
      Send <ButtonKbd combo="Mod+Enter" />
    </button>
  ));
  const button = screen.getByRole('button', { name: 'Send' });
  const chip = button.querySelector('kbd');
  expect(chip?.textContent).toBe(keyLabel('Mod+Enter'));
  expect(chip?.getAttribute('aria-hidden')).toBe('true');
  expect(chip?.classList.contains('bg-current/15')).toBe(true);
});
