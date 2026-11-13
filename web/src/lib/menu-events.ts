import { onCleanup, onMount } from 'solid-js';

export function focusMenuItem(event: KeyboardEvent, panel: HTMLElement | undefined): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  if (!panel) return;
  const items = [...panel.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])')];
  if (!items.length) return;
  event.preventDefault();
  let index = items.findIndex((item) => item === document.activeElement);
  if (event.key === 'Home') index = 0;
  else if (event.key === 'End') index = items.length - 1;
  else {
    const step = event.key === 'ArrowUp' ? -1 : 1;
    index = (index + step + items.length) % items.length;
  }
  items[index]?.focus();
}

// Both menu types own the same document listeners and release them together.
export function createMenuEvents(options: {
  open: () => boolean;
  panel: () => HTMLElement | undefined;
  trigger?: () => HTMLElement | undefined;
  close: () => void;
  dismiss: () => void;
  roving?: () => boolean;
}): void {
  const pointerdown = (event: PointerEvent) => {
    if (!options.open()) return;
    if (!(event.target instanceof Node)) return;
    if (options.panel()?.contains(event.target)) return;
    if (options.trigger?.()?.contains(event.target)) return;
    options.dismiss();
  };
  const keydown = (event: KeyboardEvent) => {
    if (!options.open()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      options.close();
    } else if (options.roving?.()) {
      focusMenuItem(event, options.panel());
      if (event.defaultPrevented) event.stopImmediatePropagation();
    }
  };
  onMount(() => {
    document.addEventListener('pointerdown', pointerdown);
    window.addEventListener('keydown', keydown, true);
  });
  onCleanup(() => {
    document.removeEventListener('pointerdown', pointerdown);
    window.removeEventListener('keydown', keydown, true);
  });
}
