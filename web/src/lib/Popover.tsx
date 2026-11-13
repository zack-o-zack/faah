import type { JSX } from 'solid-js';

export interface PopoverProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClose?: (reason: string) => void;
  onOpen?: () => void;
  gap?: number;
  role?: 'menu' | 'dialog';
  triggerId?: string;
  triggerTitle?: string;
  panelId?: string;
  accessibleLabel?: string;
  disabled?: boolean;
  triggerClass?: string;
  panelClass?: string;
  control?: string;
  variant?: string;
  size?: string;
  autofocus?: boolean;
  label?: JSX.Element;
  children?: JSX.Element | ((close: (reason?: string) => void) => JSX.Element);
}
import { Portal } from 'solid-js/web';
import { createSignal, createUniqueId, onMount, onCleanup, Show } from 'solid-js';
import { createMenuEvents } from './menu-events.ts';

export function Popover(props: PopoverProps): JSX.Element {
  const [localOpen, setLocalOpen] = createSignal(false);
  const open = () => props.open ?? localOpen();
  function setOpen(value: boolean) {
    if (props.onOpenChange) props.onOpenChange(value);
    else setLocalOpen(value);
  }
  const id = createUniqueId();
  let trigger: HTMLButtonElement | undefined;
  let panel: HTMLDivElement | undefined;
  let resize: ResizeObserver | undefined;
  onCleanup(() => resize?.disconnect());
  const [position, setPosition] = createSignal({ left: '8px', top: '8px' });
  function place() {
    if (!open() || !trigger || !panel) return;
    const rect = trigger.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(innerWidth - panel.offsetWidth - 8, rect.right - panel.offsetWidth),
    );
    let top = rect.bottom + (props.gap ?? 4);
    if (top + panel.offsetHeight > innerHeight - 8)
      top = Math.max(8, rect.top - panel.offsetHeight - (props.gap ?? 4));
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
    <div class="dropdown-menu contents">
      <button
        ref={(element) => {
          trigger = element;
        }}
        id={props.triggerId}
        title={props.triggerTitle}
        aria-label={props.accessibleLabel}
        disabled={props.disabled}
        type="button"
        class={props.triggerClass || 'btn'}
        data-control={props.control}
        data-variant={props.variant || 'ghost'}
        data-size={props.size || 'xs'}
        aria-haspopup={props.role || 'dialog'}
        aria-expanded={open()}
        aria-controls={props.panelId || id}
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
          <div class="dropdown-menu contents">
            <div
              ref={(el) => {
                panel = el;
                resize?.disconnect();
                if (typeof ResizeObserver !== 'undefined') {
                  resize = new ResizeObserver(place);
                  resize.observe(el);
                }
                queueMicrotask(() => {
                  place();
                  if (props.autofocus)
                    el.querySelector<HTMLElement>('button, input, [tabindex="0"]')?.focus();
                });
              }}
              id={props.panelId || id}
              role={props.role || 'dialog'}
              aria-label={
                props.accessibleLabel || (typeof props.label === 'string' ? props.label : undefined)
              }
              data-popover
              aria-hidden="false"
              style={position()}
              class={
                props.panelClass ||
                'fixed min-w-[190px] max-w-[min(380px,95vw)] z-[70] top-auto left-auto m-0 gap-0'
              }
              onClick={(e) => {
                if (
                  props.role === 'menu' &&
                  e.target instanceof Element &&
                  e.target.closest('[role^="menuitem"]')
                )
                  close('select');
              }}
            >
              {typeof props.children === 'function' ? props.children(close) : props.children}
            </div>
          </div>
        </Portal>
      </Show>
    </div>
  );
}
