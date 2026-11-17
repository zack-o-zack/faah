import type { JSX } from 'solid-js';
interface KbdProps {
  combo: string;
  menu?: boolean;
  variant?: 'button';
  class?: string;
}
export interface ShortcutOptions {
  target?: EventTarget;
  inputs?: boolean;
  when?: (event: KeyboardEvent) => boolean;
  preventDefault?: boolean;
  stopPropagation?: boolean;
  capture?: boolean;
}
import { Index, onCleanup } from 'solid-js';
import { keyCaps, matchesShortcut } from './keyboard.ts';
const KEY_NAMES: Record<string, string> = {
  '⌘': 'Command',
  '⌃': 'Control',
  '⌥': 'Option',
  '⇧': 'Shift',
  '↩': 'Return',
};
export function Kbd(props: KbdProps): JSX.Element {
  return (
    <span
      class={`inline-flex items-center gap-1 ${props.class || ''}`}
      data-control="shortcut"
      data-shortcut={props.menu ? '' : undefined}
      aria-hidden={props.variant === 'button' ? 'true' : undefined}
    >
      <Index each={keyCaps(props.combo)}>
        {(key) => (
          <kbd
            class={props.variant === 'button' ? 'kbd bg-current/15 text-current' : 'kbd'}
            data-variant={props.variant}
            data-single={key().length === 1 ? '' : undefined}
            aria-label={KEY_NAMES[key()]}
            title={KEY_NAMES[key()]}
          >
            {key()}
          </kbd>
        )}
      </Index>
    </span>
  );
}
export function createShortcut(
  combo: string | null,
  action: (event: KeyboardEvent) => void,
  options: ShortcutOptions = {},
): void {
  const target = options.target || document;
  const listener = (raw: Event) => {
    if (!(raw instanceof KeyboardEvent)) return;
    const event = raw;
    if (
      !options.inputs &&
      event.target instanceof Element &&
      event.target.closest('input, textarea, select, [contenteditable="true"], [role="menu"]')
    )
      return;
    if (
      (combo === null || matchesShortcut(event, combo)) &&
      (!options.when || options.when(event))
    ) {
      if (options.preventDefault !== false) event.preventDefault();
      if (options.stopPropagation) event.stopImmediatePropagation();
      action(event);
    }
  };
  target.addEventListener('keydown', listener, !!options.capture);
  onCleanup(() => target.removeEventListener('keydown', listener, !!options.capture));
}
