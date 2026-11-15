import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { expect, test } from 'vitest';
import { OptionButton } from './OptionButton.tsx';

test('option labels never wrap and selected styling follows aria-checked', () => {
  render(() => {
    const [selected, setSelected] = createSignal(false);
    return (
      <OptionButton
        selected={selected()}
        label="Request changes"
        hint="Feedback must be addressed before merging"
        onClick={() => setSelected(!selected())}
      />
    );
  });
  const option = screen.getByRole('radio', { name: 'Request changes' });
  expect(option.classList.contains('whitespace-normal')).toBe(false);
  expect(screen.getByText('Request changes').classList.contains('whitespace-nowrap')).toBe(true);
  expect(option.getAttribute('data-variant')).toBe('outline');
  expect(option.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(option);
  expect(option.getAttribute('aria-checked')).toBe('true');
  expect(option.className).toContain('aria-checked:border-primary');
  expect(option.getAttribute('data-variant')).toBe('outline');
});
