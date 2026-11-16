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
  expect(option.tabIndex).toBe(0);
  expect(option.getAttribute('data-variant')).toBe('outline');
});

test('verdict radios use one keyboard stop and arrows skip disabled options and wrap', () => {
  render(() => {
    const [selected, setSelected] = createSignal('comment');
    return (
      <div class="button-group" role="radiogroup" aria-label="Review verdict">
        <OptionButton
          selected={selected() === 'comment'}
          label="Comment"
          onClick={() => setSelected('comment')}
        />
        <OptionButton
          selected={selected() === 'approve'}
          label="Approve"
          disabled
          onClick={() => setSelected('approve')}
        />
        <OptionButton
          selected={selected() === 'changes'}
          label="Request changes"
          onClick={() => setSelected('changes')}
        />
      </div>
    );
  });
  const comment = screen.getByRole<HTMLButtonElement>('radio', { name: 'Comment' });
  const changes = screen.getByRole<HTMLButtonElement>('radio', { name: 'Request changes' });
  comment.focus();
  for (const key of ['ArrowRight', 'ArrowDown', 'End']) {
    fireEvent.keyDown(comment, { key });
    expect(changes.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(changes);
    expect(comment.tabIndex).toBe(-1);
    fireEvent.keyDown(changes, { key: 'Home' });
    expect(comment.getAttribute('aria-checked')).toBe('true');
  }
  fireEvent.keyDown(comment, { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(changes);
  fireEvent.keyDown(changes, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(comment);
});
