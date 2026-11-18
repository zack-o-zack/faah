import type { JSX } from 'solid-js';
interface KbdProps {
  combo: string;
  menu?: boolean;
  variant?: 'button';
  chord?: boolean;
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
import { keyCaps, keyChord, keyChordLabel, keyGlyphName, matchesShortcut } from './keyboard.ts';
export function Kbd(props: KbdProps): JSX.Element {
  const caps = (): string[] => (props.chord ? [keyChord(props.combo)] : keyCaps(props.combo));
  const name = (key: string): string | undefined =>
    props.chord ? keyChordLabel(props.combo) : keyGlyphName(key);
  return (
    <span
      class={`inline-flex items-center gap-1 ${props.class || ''}`}
      data-control="shortcut"
      data-shortcut={props.menu ? '' : undefined}
      aria-hidden={props.variant === 'button' ? 'true' : undefined}
    >
      <Index each={caps()}>
        {(key) => (
          <kbd
            class={props.variant === 'button' ? 'kbd bg-current/15 text-current' : 'kbd'}
            data-variant={props.variant}
            data-single={key().length === 1 ? '' : undefined}
            aria-label={name(key())}
            title={name(key())}
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
