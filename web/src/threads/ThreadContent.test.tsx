import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { expect, test, vi } from 'vitest';
import { ThreadListRow } from './ThreadListRow.tsx';

test('deleting a populated thread does not open it and keyboard activation opens the row', () => {
  const open = vi.fn();
  const remove = vi.fn();
  render(() => (
    <ThreadListRow
      thread={{ id: 't', title: 'Explain startup', kind: 'explain', turns: 1, failed: true }}
      selected={false}
      onOpen={open}
      onDelete={remove}
    />
  ));
  expect(document.querySelector('[data-ui="thr-item-ref"]')?.textContent).toBe('Explain startup');
  expect(screen.getByTitle('Last reply failed')).toBeTruthy();
  const button = screen.getByRole('button', { name: 'Delete thread' });
  expect(button.dataset.variant).toBe('ghost');
  expect(button.dataset.size).toBe('icon-xs');
  fireEvent.click(button);
  expect(remove).toHaveBeenCalledOnce();
  expect(open).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('button', { name: /Explain startup/ }), { key: 'Enter' });
  expect(open).toHaveBeenCalledOnce();
});

test('thread status hooks map running and failed agent work to spirals, with no finished mark', () => {
  const [thread, setThread] = createSignal({
    id: 'busy',
    title: 'Reading code',
    running: true,
    failed: false,
  });
  render(() => (
    <ThreadListRow thread={thread()} selected={false} onOpen={() => {}} onDelete={() => {}} />
  ));
  expect(screen.getByTitle('Working').querySelector('[data-state="thinking"]')).toBeTruthy();
  expect(document.querySelector('[data-ui="thr-spin"]')).toBeTruthy();
  setThread({ id: 'busy', title: 'Reading code', running: false, failed: true });
  expect(screen.getByRole('img', { name: 'Failed' }).getAttribute('data-state')).toBe('error');
  expect(document.querySelector('[data-ui="thr-spin"]')).toBeNull();
  expect(document.querySelector('[data-ui="thr-fail"]')).toBeTruthy();
  setThread({ id: 'busy', title: 'Reading code', running: false, failed: false });
  expect(document.querySelector('.fibo-spiral')).toBeNull();
});
