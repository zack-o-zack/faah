import { render, screen, fireEvent } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { test, expect, vi } from 'vitest';
import { createMenuEvents } from './menu-events.js';

function MenuHarness(props) {
  const [open] = createSignal(true);
  let panel;
  let trigger;
  createMenuEvents({
    open,
    panel: () => panel,
    trigger: () => trigger,
    roving: () => true,
    close: () => props.close(),
    dismiss: () => props.dismiss(),
  });
  return (
    <>
      <button
        ref={(element) => {
          trigger = element;
        }}
      >
        Trigger
      </button>
      <div
        ref={(element) => {
          panel = element;
        }}
        role="menu"
      >
        <button role="menuitem">First</button>
        <button role="menuitem" disabled>
          Disabled
        </button>
        <button role="menuitem">Last</button>
      </div>
      <button>Outside</button>
    </>
  );
}

test('menu keys wrap, skip disabled items and select endpoints', () => {
  render(() => <MenuHarness close={() => {}} dismiss={() => {}} />);
  const first = screen.getByRole('menuitem', { name: 'First' });
  const last = screen.getByRole('menuitem', { name: 'Last' });
  first.focus();
  fireEvent.keyDown(first, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: 'Home' });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: 'End' });
  expect(document.activeElement).toBe(last);
});

test('outside clicks and Escape dismiss, with listeners released on disposal', () => {
  const close = vi.fn();
  const dismiss = vi.fn();
  const view = render(() => <MenuHarness close={close} dismiss={dismiss} />);
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Trigger' }));
  fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'First' }));
  expect(dismiss).not.toHaveBeenCalled();
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
  expect(dismiss).toHaveBeenCalledOnce();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
  view.unmount();
  fireEvent.pointerDown(document.body);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(dismiss).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});
