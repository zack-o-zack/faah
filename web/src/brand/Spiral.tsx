import { createEffect, onCleanup, onMount, type JSX } from 'solid-js';
import { attachSpiral, restShape, type SpiralState } from './spiral-engine.ts';

interface SpiralProps {
  state: SpiralState;
  size?: number;
  label?: string;
}
export function Spiral(props: SpiralProps): JSX.Element {
  let svg: SVGSVGElement | undefined;
  let path: SVGPathElement | undefined;
  onMount(() => {
    if (!svg || !path) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handle = attachSpiral(svg, path, typeof IntersectionObserver === 'undefined');
    handle.setReducedMotion(media.matches);
    const motionChanged = () => handle.setReducedMotion(media.matches);
    media.addEventListener('change', motionChanged);
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver((entries) => {
            for (const entry of entries) handle.setVisible(entry.isIntersecting);
          });
    observer?.observe(svg);
    createEffect(() => handle.set(props.state));
    onCleanup(() => {
      handle.destroy();
      media.removeEventListener('change', motionChanged);
      observer?.disconnect();
    });
  });
  return (
    <svg
      ref={svg}
      class="fibo-spiral"
      viewBox="-40 -44 104 78"
      style={{ width: `${props.size ?? 22}px` }}
      data-state={props.state}
      role={props.label ? 'img' : undefined}
      aria-label={props.label || undefined}
      aria-hidden={props.label ? undefined : 'true'}
    >
      <path ref={path} d={restShape()} stroke-width={(props.size ?? 22) <= 32 ? 11 : 7.5} />
    </svg>
  );
}
