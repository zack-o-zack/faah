import { onCleanup } from 'solid-js';

export function SplitHandle(props) {
  let release = () => {};
  onCleanup(() => release());
  const change = (delta) =>
    props.onChange(Math.max(props.min ?? 0, Math.min(props.max ?? Infinity, props.value + delta)));
  return (
    <div
      role="separator"
      tabindex="0"
      aria-label={props.label}
      aria-orientation={props.vertical ? 'horizontal' : 'vertical'}
      aria-valuenow={props.value}
      aria-valuemin={props.min ?? 0}
      aria-valuemax={props.max}
      class="split-handle"
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
        const onPointerMove = (e) => {
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
