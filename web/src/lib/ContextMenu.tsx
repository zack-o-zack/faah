import type { JSX } from 'solid-js';

interface ContextMenuProps {
  label?: string;
  onClose?: () => void;
  menu?: JSX.Element;
  children?:
    | JSX.Element
    | ((controls: {
        open: (event: MouseEvent & { currentTarget: HTMLElement }) => void;
      }) => JSX.Element);
}
import { createSignal, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { createMenuEvents } from './menu-events.ts';

export function ContextMenu(props: ContextMenuProps): JSX.Element {
  const [point, setPoint] = createSignal<{ x: number; y: number } | null>(null);
  let panel: HTMLDivElement | undefined;
  let previous: Element | null = null;
  const close = () => {
    setPoint(null);
    props.onClose?.();
    if (previous instanceof HTMLElement) previous.focus();
  };
  const open = (event: MouseEvent & { currentTarget: HTMLElement }) => {
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
          <div class="dropdown-menu contents">
            <div
              ref={(el) => {
                panel = el;
                queueMicrotask(() => el.querySelector('button')?.focus());
              }}
              id="tree-menu"
              data-popover
              aria-hidden="false"
              class="fixed min-w-[190px] max-w-[min(380px,95vw)] z-[70] top-auto left-auto m-0 gap-0"
              role="menu"
              aria-label={props.label}
              style={{ left: `${point()?.x}px`, top: `${point()?.y}px` }}
              onClick={close}
            >
              {props.menu}
            </div>
          </div>
        </Portal>
      </Show>
    </div>
  );
}
