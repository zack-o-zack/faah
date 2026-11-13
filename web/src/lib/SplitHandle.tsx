import type { JSX } from 'solid-js';

interface SplitHandleProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  reverse?: boolean;
  vertical?: boolean;
  class?: string;
  onChange: (value: number) => void;
}
import { onCleanup } from 'solid-js';

export function SplitHandle(props: SplitHandleProps): JSX.Element {
  let release = () => {};
  onCleanup(() => release());
  // A reversed handle sits on the far edge of what it sizes: dragging toward it shrinks it.
  const change = (delta: number) =>
    props.onChange(
      Math.max(
        props.min ?? 0,
        Math.min(props.max ?? Infinity, props.value + (props.reverse ? -delta : delta)),
      ),
    );
  return (
    <div
      role="separator"
      tabindex="0"
      aria-label={props.label}
      aria-orientation={props.vertical ? 'horizontal' : 'vertical'}
      aria-valuenow={props.value}
      aria-valuemin={props.min ?? 0}
      aria-valuemax={props.max}
      class={
        props.class ||
        (props.vertical
          ? 'split-handle h-1 w-full shrink-0 hover:bg-primary'
          : 'split-handle h-full w-1 shrink-0 hover:bg-primary')
      }
      style={{ 'touch-action': 'none', cursor: props.vertical ? 'row-resize' : 'col-resize' }}
      onKeyDown={(e) => {
        if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(e.key)) {
          e.preventDefault();
          change((e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) * (e.shiftKey ? 40 : 10));
        }
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        release();
        e.preventDefault();
        let last = props.vertical ? e.clientY : e.clientX;
        const onPointerMove = (e: PointerEvent) => {
          const at = props.vertical ? e.clientY : e.clientX;
          change(at - last);
          last = at;
        };
        // Removing a handler does not evaluate the reactive reads inside that handler.
        // eslint-disable-next-line solid/reactivity
        release = () => {
          document.removeEventListener('pointermove', onPointerMove);
          document.removeEventListener('pointerup', release);
          document.removeEventListener('pointercancel', release);
        };
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', release);
        document.addEventListener('pointercancel', release);
      }}
    />
  );
}
