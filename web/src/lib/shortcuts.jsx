import { Index, onCleanup, Show } from 'solid-js';
import { keyLabel, keyCaps, matchesShortcut } from './keyboard.js';
export function Kbd(props) {
  return (
    <kbd class="kbd">
      <ShowCaps combo={props.combo} caps={props.caps} />
    </kbd>
  );
}
function ShowCaps(props) {
  return (
    <Show when={props.caps} fallback={keyLabel(props.combo)}>
      <Index each={keyCaps(props.combo)}>{(key) => <kbd class="kbd">{key()}</kbd>}</Index>
    </Show>
  );
}
export function createShortcut(combo, action, options = {}) {
  const target = options.target || document;
  const listener = (event) => {
    if (
      !options.inputs &&
      event.target?.closest?.('input, textarea, select, [contenteditable="true"], [role="menu"]')
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
