import { createRoot, createSignal } from 'solid-js';
import { expect, test, vi } from 'vitest';
import { createOrbFade } from './orb-fade.ts';
test('finished orb waits five seconds, pauses for hover/focus and keeps failures', () => {
  vi.useFakeTimers();
  createRoot((dispose) => {
    const [phase, setPhase] = createSignal('running');
    const [hover, setHover] = createSignal(false);
    const dismiss = vi.fn();
    createOrbFade(phase, hover, dismiss);
    queueMicrotask(() => {});
    setPhase('done');
    // Solid effects begin after this root's initial rendering.
    setTimeout(() => {
      vi.advanceTimersByTime(4999);
      expect(dismiss).not.toHaveBeenCalled();
      setHover(true);
      vi.advanceTimersByTime(6000);
      expect(dismiss).not.toHaveBeenCalled();
      setHover(false);
      vi.advanceTimersByTime(5200);
      expect(dismiss).toHaveBeenCalledTimes(1);
      setPhase('failed');
      vi.advanceTimersByTime(10000);
      expect(dismiss).toHaveBeenCalledTimes(1);
      dispose();
    }, 0);
  });
  vi.advanceTimersByTime(0);
  vi.useRealTimers();
});
