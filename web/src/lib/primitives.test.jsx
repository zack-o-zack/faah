import { createRoot } from 'solid-js';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { DropdownMenu } from './DropdownMenu.jsx';
import { Select } from './Select.jsx';
import { SplitHandle } from './SplitHandle.jsx';
import { Dialog } from './Dialog.jsx';
import { Tooltip } from './Tooltip.jsx';
import { ContextMenu } from './ContextMenu.jsx';
import { createToastStore, Toaster } from './toast.jsx';
import { createShortcut, Kbd } from './shortcuts.jsx';
import { createEventStream, createPolling } from './events.js';
import { createAppStore } from '../app/store.js';
import { AppProvider, useApp } from '../app/context.jsx';
test('mounts a component with isolated app state', () => {
  const store = createAppStore();
  const other = createAppStore();
  function Pref() {
    const { state } = useApp();
    return <span>{String(state.editor.wrap)}</span>;
  }
  render(() => (
    <AppProvider store={store}>
      <Pref />
    </AppProvider>
  ));
  store.actions.setEditorPreference('wrap', false);
  expect(screen.getByText('false')).toBeTruthy();
  expect(other.state.editor.wrap).toBe(true);
});
test('menu supports Escape and restores trigger focus', async () => {
  const user = userEvent.setup();
  render(() => (
    <DropdownMenu label="Actions">
      <button role="menuitem">Open</button>
    </DropdownMenu>
  ));
  const trigger = screen.getByRole('button', { name: 'Actions' });
  await user.click(trigger);
  expect(screen.getByRole('menu')).toBeTruthy();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
test('select emits values and split handle clamps keyboard resizing', () => {
  const change = vi.fn();
  render(() => (
    <>
      <Select
        label="Theme"
        value="a"
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
        onChange={change}
      />
      <SplitHandle label="Sidebar" value={95} min={20} max={100} onChange={change} />
    </>
  ));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'b' } });
  expect(change).toHaveBeenCalledWith('b');
  fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
  expect(change).toHaveBeenCalledWith(100);
});
test('toasts render text safely and can be dismissed', async () => {
  const service = createToastStore();
  render(() => <Toaster store={service} />);
  service.toast('success', '<img onerror=alert(1)>', 0);
  expect(screen.getByRole('status').textContent).toContain('<img');
  expect(document.querySelector('img')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
  expect(screen.queryByRole('status')).toBeNull();
});
test('shortcuts release listeners on unmount', () => {
  const action = vi.fn();
  function Keys() {
    createShortcut('Mod+P', action);
    return <Kbd combo="Mod+P" />;
  }
  const view = render(() => <Keys />);
  fireEvent.keyDown(document, { key: 'p', ctrlKey: true });
  expect(action).toHaveBeenCalledTimes(1);
  view.unmount();
  fireEvent.keyDown(document, { key: 'p', ctrlKey: true });
  expect(action).toHaveBeenCalledTimes(1);
});
test('streams ignore malformed frames and close on disposal', async () => {
  let stream;
  class Source {
    constructor() {
      stream = this;
      this.handlers = {};
    }
    addEventListener(k, fn) {
      this.handlers[k] = fn;
    }
    close = vi.fn();
  }
  vi.stubGlobal('EventSource', Source);
  const handler = vi.fn();
  const dispose = createRoot((dispose) => {
    createEventStream('api/stream', { state: handler });
    return dispose;
  });
  stream.handlers.state({ data: 'bad' });
  stream.handlers.state({ data: '{"ok":true}' });
  await Promise.resolve();
  expect(handler).toHaveBeenCalledWith({ ok: true });
  dispose();
  expect(stream.close).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});
test('polling stops after disposal even with a request in flight', async () => {
  vi.useFakeTimers();
  let finish;
  const action = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const dispose = createRoot((dispose) => {
    createPolling(action, 100, false);
    return dispose;
  });
  dispose();
  finish();
  await vi.advanceTimersByTimeAsync(1000);
  expect(action).toHaveBeenCalledOnce();
  vi.useRealTimers();
});
test('dialog requests close on Escape and releases its modal on disposal', () => {
  const close = vi.fn();
  const view = render(() => (
    <Dialog open={true} title="Confirm" onClose={close}>
      <p>Continue?</p>
    </Dialog>
  ));
  const dialog = screen.getByRole('dialog');
  expect(dialog.open).toBe(true);
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(close).toHaveBeenCalledOnce();
  view.unmount();
  expect(dialog.open).toBe(false);
});
test('tooltip opens on focus and closes on Escape', () => {
  render(() => <Tooltip text="Help">{(attrs) => <button {...attrs}>Info</button>}</Tooltip>);
  fireEvent.focusIn(screen.getByRole('button'));
  expect(screen.getByRole('tooltip').textContent).toBe('Help');
  fireEvent.keyDown(screen.getByRole('button'), { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).toBeNull();
});

test('context menu supports keyboard opening and returns focus', async () => {
  render(() => (
    <ContextMenu label="File" menu={<button role="menuitem">Open file</button>}>
      <button>File</button>
    </ContextMenu>
  ));
  const trigger = screen.getByRole('button', { name: 'File' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'F10', shiftKey: true });
  expect(screen.getByRole('menu')).toBeTruthy();
  await Promise.resolve();
  fireEvent.keyDown(screen.getByRole('menuitem'), { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
