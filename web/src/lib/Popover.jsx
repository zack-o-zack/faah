import { Portal } from 'solid-js/web';
import { createSignal, createUniqueId, onMount, onCleanup, Show } from 'solid-js';
import { createMenuEvents } from './menu-events.js';

export function Popover(props) {
  const [localOpen, setLocalOpen] = createSignal(false);
  const open = () => props.open ?? localOpen();
  function setOpen(value) {
    if (props.onOpenChange) props.onOpenChange(value);
    else setLocalOpen(value);
  }
  const id = createUniqueId();
  let trigger, panel;
  const [position, setPosition] = createSignal({ left: '8px', top: '8px' });
  function place() {
    if (!open() || !trigger || !panel) return;
    const rect = trigger.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(innerWidth - panel.offsetWidth - 8, rect.right - panel.offsetWidth),
    );
    let top = rect.bottom + 4;
    if (top + panel.offsetHeight > innerHeight - 8)
      top = Math.max(8, rect.top - panel.offsetHeight - 4);
    setPosition({ left: left + 'px', top: top + 'px' });
  }
  onMount(() => {
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    onCleanup(() => {
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    });
  });
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
        <Portal>
          <div
            ref={(el) => {
              panel = el;
              queueMicrotask(() => {
                place();
                el.querySelector('button, input, [tabindex="0"]')?.focus();
              });
            }}
            id={id}
            role={props.role || 'dialog'}
            aria-label={props.label}
            data-popover
            style={position()}
            class={`fixed z-50 min-w-48 rounded-md
        border bg-popover p-1 text-popover-foreground`}
            onClick={(e) => {
              if (props.role === 'menu' && e.target.closest('[role^="menuitem"]')) close('select');
            }}
          >
            {typeof props.children === 'function' ? props.children(close) : props.children}
          </div>
        </Portal>
      </Show>
    </div>
  );
}
