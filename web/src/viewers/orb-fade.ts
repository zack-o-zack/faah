import type { Accessor } from 'solid-js';
import { createEffect, createSignal, onCleanup } from 'solid-js';
export function createOrbFade(
  phase: Accessor<string | undefined>,
  held: Accessor<boolean>,
  dismiss: () => void,
): Accessor<boolean> {
  const [fading, setFading] = createSignal(false);
  createEffect(() => {
    setFading(false);
    if (phase() !== 'done' || held()) return;
    let finish: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      setFading(true);
      finish = setTimeout(
        dismiss,
        matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200,
      );
    }, 5000);
    onCleanup(() => {
      clearTimeout(timer);
      clearTimeout(finish);
    });
  });
  return fading;
}
