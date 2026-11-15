import type { JSX } from 'solid-js';

interface SplitHandleProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  reverse?: boolean;
  vertical?: boolean;
  class?: string;
  disabled?: boolean;
  readValue?: () => number;
  onChange: (value: number) => void;
  onChangeEnd?: (value: number) => void;
}
import { createEffect, createSignal, onCleanup } from 'solid-js';

export function SplitHandle(props: SplitHandleProps): JSX.Element {
  const [dragging, setDragging] = createSignal(false);
  let release = () => {};
  onCleanup(() => release());
  createEffect(() => {
    if (props.disabled) release();
  });
  // A reversed handle sits on the far edge of what it sizes: dragging toward it shrinks it.
  const value = () => props.readValue?.() ?? props.value;
  const change = (delta: number, from = value()) =>
    props.onChange(
      Math.max(
        props.min ?? 0,
        Math.min(props.max ?? Infinity, from + (props.reverse ? -delta : delta)),
      ),
    );
  return (
    <div
      role="separator"
      tabindex={props.disabled ? -1 : 0}
      aria-disabled={props.disabled || undefined}
      aria-label={props.label}
      aria-orientation={props.vertical ? 'horizontal' : 'vertical'}
      data-dragging={dragging() ? '' : undefined}
      aria-valuenow={props.value}
      aria-valuemin={props.min ?? 0}
      aria-valuemax={props.max}
      class={`split-handle shrink-0 hover:bg-primary focus-visible:bg-primary data-[dragging]:bg-primary aria-disabled:pointer-events-none ${props.vertical ? 'h-1 w-full' : 'h-full w-1'} ${props.class || ''}`}
      style={{
        'touch-action': 'none',
        cursor: props.disabled ? 'default' : undefined,
      }}
      onKeyDown={(e) => {
        if (props.disabled) return;
        if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(e.key)) {
          e.preventDefault();
          change((e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) * (e.shiftKey ? 40 : 10));
          props.onChangeEnd?.(value());
        }
      }}
      onPointerDown={(e) => {
        if (props.disabled || e.button !== 0) return;
        release();
        setDragging(true);
        e.preventDefault();
        let last = props.vertical ? e.clientY : e.clientX;
        let current = value();
        const onPointerMove = (e: PointerEvent) => {
          const at = props.vertical ? e.clientY : e.clientX;
          change(at - last, current);
          // A CSS bound may have capped the requested size. Rebase on the rendered
          // panel so the first pixel back from either edge resizes immediately.
          current = value();
          last = at;
        };
        // Removing a handler does not evaluate the reactive reads inside that handler.
        // eslint-disable-next-line solid/reactivity
        release = () => {
          setDragging(false);
          document.removeEventListener('pointermove', onPointerMove);
          document.removeEventListener('pointerup', finish);
          document.removeEventListener('pointercancel', finish);
        };
        const finish = () => {
          release();
          props.onChangeEnd?.(value());
        };
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', finish);
        document.addEventListener('pointercancel', finish);
      }}
    />
  );
}
