import { For, onCleanup, Show } from 'solid-js';
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
      <For each={keyCaps(props.combo)}>{(key) => <kbd class="kbd">{key}</kbd>}</For>
    </Show>
  );
}
export function createShortcut(combo, action, options = {}) {
  const target = options.target || document;
  const listener = (event) => {
    if (!options.inputs && event.target?.closest?.('input, textarea, [contenteditable="true"]'))
      return;
    if (matchesShortcut(event, combo) && (!options.when || options.when())) {
      event.preventDefault();
      action(event);
    }
  };
  target.addEventListener('keydown', listener);
  onCleanup(() => target.removeEventListener('keydown', listener));
}
