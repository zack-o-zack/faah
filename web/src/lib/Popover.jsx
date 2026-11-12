import { createSignal, createUniqueId, Show } from 'solid-js';
import { createMenuEvents } from './menu-events.js';

export function Popover(props) {
  const [open, setOpen] = createSignal(false);
  const id = createUniqueId();
  let trigger, panel;
  const close = (reason = 'dismiss') => {
    setOpen(false);
    trigger?.focus();
    props.onClose?.(reason);
  };
  createMenuEvents({
    open,
    panel: () => panel,
    trigger: () => trigger,
    close,
    dismiss: () => {
      setOpen(false);
      props.onClose?.('dismiss');
    },
    roving: () => props.role === 'menu',
  });
  return (
    <div class="dropdown-menu relative inline-block">
      <button
        ref={(element) => {
          trigger = element;
        }}
        type="button"
        class="btn"
        aria-haspopup={props.role || 'dialog'}
        aria-expanded={open()}
        aria-controls={id}
        onClick={() => {
          if (open()) close();
          else {
            props.onOpen?.();
            setOpen(true);
          }
        }}
      >
        {props.label}
      </button>
      <Show when={open()}>
        <div
          ref={(el) => {
            panel = el;
            queueMicrotask(() => el.querySelector('button, input, [tabindex="0"]')?.focus());
          }}
          id={id}
          role={props.role || 'dialog'}
          aria-label={props.label}
          data-popover
          class={`absolute bottom-full right-0 z-50 mb-1 min-w-48 rounded-md
        border bg-popover p-1 text-popover-foreground`}
          onClick={(e) => {
            if (props.role === 'menu' && e.target.closest('[role^="menuitem"]')) close('select');
          }}
        >
          {typeof props.children === 'function' ? props.children(close) : props.children}
        </div>
      </Show>
    </div>
  );
}
