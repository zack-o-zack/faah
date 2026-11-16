import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { required } from '../lib/test-values.ts';
import { Spiral } from './Spiral.tsx';
import { restShape, type SpiralState } from './spiral-engine.ts';

let now = 100;
let nextFrame = 0;
const frames = new Map<number, FrameRequestCallback>();
let reduced = false;
let media: MediaQueryList;
const requestFrame = vi.fn((callback: FrameRequestCallback) => {
  frames.set(++nextFrame, callback);
  return nextFrame;
});
const cancelFrame = vi.fn((id: number) => frames.delete(id));
beforeEach(() => {
  now = 100;
  reduced = false;
  frames.clear();
  requestFrame.mockClear();
  cancelFrame.mockClear();
  const events = new EventTarget();
  media = {
    get matches() {
      return reduced;
    },
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  };
  vi.stubGlobal('matchMedia', () => media);
  vi.stubGlobal('requestAnimationFrame', requestFrame);
  vi.stubGlobal('cancelAnimationFrame', cancelFrame);
  vi.stubGlobal('IntersectionObserver', undefined);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => {
  cleanup();
  expect(frames.size).toBe(0);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function tick(time: number): void {
  now = time;
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(time);
}
function motionPreference(value: boolean): void {
  reduced = value;
  media.dispatchEvent(new Event('change'));
}

test('state changes keep the same SVG and path and restart the motion clock', () => {
  const [state, setState] = createSignal<SpiralState>('thinking');
  const { container } = render(() => <Spiral state={state()} />);
  const svg = required(container.querySelector('svg'));
  const path = required(svg.querySelector('path'));
  tick(600);
  const thinking = path.getAttribute('d');
  expect(thinking).not.toBe(restShape());
  setState('hold');
  expect(container.querySelector('svg')).toBe(svg);
  expect(svg.querySelector('path')).toBe(path);
  expect(svg.getAttribute('data-state')).toBe('hold');
  expect(path.getAttribute('d')).toBe(restShape());
  tick(1100);
  expect(path.getAttribute('d')).not.toBe(thinking);
  setState('static');
  expect(path.getAttribute('d')).toBe(restShape());
  expect(frames.size).toBe(0);
  setState('thinking');
  tick(1600);
  expect(path.getAttribute('d')).toBe(thinking);
});
test('labels and width preserve SVG accessibility and stroke sizing', () => {
  const { container } = render(() => (
    <>
      <Spiral state="static" />
      <Spiral state="hold" label="Waiting for you" size={56} />
    </>
  ));
  const decorative = required(container.querySelector('svg'));
  expect(decorative.getAttribute('aria-hidden')).toBe('true');
  expect(decorative.hasAttribute('role')).toBe(false);
  expect(decorative.style.width).toBe('22px');
  expect(decorative.getAttribute('viewBox')).toBe('-40 -44 104 78');
  expect(decorative.querySelector('path')?.getAttribute('stroke-width')).toBe('11');
  const labelled = screen.getByRole('img', { name: 'Waiting for you' });
  expect(labelled.hasAttribute('aria-hidden')).toBe(false);
  expect(labelled.style.width).toBe('56px');
  expect(labelled.querySelector('path')?.getAttribute('stroke-width')).toBe('7.5');
});
test.each(['static', 'thinking', 'hold', 'error'] as const)(
  'reduced motion keeps %s static without scheduling frames',
  (state) => {
    reduced = true;
    const { container } = render(() => <Spiral state={state} label="Status" />);
    expect(requestFrame).not.toHaveBeenCalled();
    expect(container.querySelector('path')?.getAttribute('d')).toBe(restShape());
    expect(container.querySelector('svg')?.getAttribute('data-state')).toBe(state);
  },
);
test('a live preference change stops and permits motion', () => {
  const { container } = render(() => <Spiral state="thinking" />);
  tick(600);
  motionPreference(true);
  expect(frames.size).toBe(0);
  expect(container.querySelector('path')?.getAttribute('d')).toBe(restShape());
  motionPreference(false);
  expect(frames.size).toBe(1);
  tick(800);
  expect(container.querySelector('path')?.getAttribute('d')).not.toBe(restShape());
});
test('five spirals share one frame and unmount cancels it', () => {
  const { unmount } = render(() => (
    <>
      <Spiral state="thinking" />
      <Spiral state="thinking" />
      <Spiral state="thinking" />
      <Spiral state="thinking" />
      <Spiral state="thinking" />
    </>
  ));
  expect(requestFrame).toHaveBeenCalledTimes(1);
  tick(600);
  expect(requestFrame).toHaveBeenCalledTimes(2);
  expect(frames.size).toBe(1);
  unmount();
  expect(frames.size).toBe(0);
  tick(900);
  expect(requestFrame).toHaveBeenCalledTimes(2);
});
test('the loop drops disconnected elements', () => {
  const { container } = render(() => <Spiral state="thinking" />);
  required(container.querySelector('svg')).remove();
  tick(600);
  expect(frames.size).toBe(0);
});
test('error plays once, stays error coloured, and restarts only on a state change', () => {
  const [state, setState] = createSignal<SpiralState>('error');
  const { container } = render(() => <Spiral state={state()} label="Failed" />);
  const svg = screen.getByRole('img', { name: 'Failed' });
  const path = required(svg.querySelector('path'));
  tick(600);
  expect(path.getAttribute('d')).not.toBe(restShape());
  tick(2899);
  expect(frames.size).toBe(1);
  tick(2900);
  expect(path.getAttribute('d')).toBe(restShape());
  expect(svg.getAttribute('data-state')).toBe('error');
  expect(frames.size).toBe(0);
  motionPreference(true);
  motionPreference(false);
  expect(frames.size).toBe(0);
  setState('thinking');
  setState('error');
  tick(3100);
  expect(container.querySelector('svg')).toBe(svg);
  expect(path.getAttribute('d')).not.toBe(restShape());
});
test('offscreen handles pause and resume without replaying a finished error', () => {
  let visibility: ((visible: boolean) => void) | undefined;
  const disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        visibility = (visible) => {
          const target = required(document.querySelector('svg'));
          const rect = target.getBoundingClientRect();
          callback(
            [
              {
                target,
                isIntersecting: visible,
                intersectionRatio: visible ? 1 : 0,
                time: now,
                boundingClientRect: rect,
                intersectionRect: rect,
                rootBounds: null,
              },
            ],
            this,
          );
        };
      }
      root = null;
      rootMargin = '0px';
      scrollMargin = '0px';
      thresholds = [0];
      observe() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
      disconnect = disconnect;
    },
  );
  const { unmount } = render(() => <Spiral state="error" />);
  expect(requestFrame).not.toHaveBeenCalled();
  required(visibility)(true);
  tick(600);
  required(visibility)(false);
  expect(frames.size).toBe(0);
  now = 4000;
  required(visibility)(true);
  expect(frames.size).toBe(0);
  expect(document.querySelector('path')?.getAttribute('d')).toBe(restShape());
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});
