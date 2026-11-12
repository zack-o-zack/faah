import { createSignal, createUniqueId, Show } from 'solid-js';

export function Tooltip(props) {
  const [shown, setShown] = createSignal(false);
  const id = createUniqueId();
  return (
    <span
      class="relative"
      onMouseEnter={() => setShown(true)}
      onMouseLeave={() => setShown(false)}
      onFocusIn={() => setShown(true)}
      onFocusOut={() => setShown(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setShown(false);
      }}
    >
      {props.children({ 'aria-describedby': id })}
      <Show when={shown()}>
        <span
          id={id}
          role="tooltip"
          class="tooltip absolute bottom-full bg-popover p-2 text-popover-foreground"
        >
          {props.text}
        </span>
      </Show>
    </span>
  );
}
