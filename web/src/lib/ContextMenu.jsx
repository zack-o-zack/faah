import { createSignal, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { createMenuEvents } from './menu-events.js';

export function ContextMenu(props) {
  const [point, setPoint] = createSignal(null);
  let panel, previous;
  const close = () => {
    setPoint(null);
    props.onClose?.();
    previous?.focus();
  };
  const open = (event) => {
    event.preventDefault();
    event.stopPropagation();
    previous = document.activeElement;
    const rect = event.currentTarget.getBoundingClientRect();
    setPoint({ x: rect.right, y: rect.top });
  };
  createMenuEvents({
    open: () => !!point(),
    panel: () => panel,
    close,
    dismiss: close,
    roving: () => true,
  });
  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        previous = document.activeElement;
        setPoint({ x: e.clientX, y: e.clientY });
      }}
      onKeyDown={(e) => {
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault();
          previous = document.activeElement;
          const r = e.currentTarget.getBoundingClientRect();
          setPoint({ x: r.left, y: r.top });
        }
      }}
    >
      {typeof props.children === 'function' ? props.children({ open }) : props.children}
      <Show when={point()}>
        <Portal>
          <div
            ref={(el) => {
              panel = el;
              queueMicrotask(() => el.querySelector('button')?.focus());
            }}
            class="dropdown-menu fixed z-50 border bg-popover p-1"
            role="menu"
            aria-label={props.label}
            style={{ left: `${point().x}px`, top: `${point().y}px` }}
            onClick={close}
          >
            {props.menu}
          </div>
        </Portal>
      </Show>
    </div>
  );
}
