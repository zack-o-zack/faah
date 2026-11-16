import { render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';
import { required } from '../lib/test-values.ts';
import { createWalkPadding } from './walk-padding.ts';

afterEach(() => vi.unstubAllGlobals());

test('review padding follows card and pane resizing, skips narrow panes, and clears on stop', () => {
  let resize: (() => void) | undefined;
  const disconnect = vi.fn();
  const observe = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const card = document.createElement('div');
  card.id = 'explain-orb';
  let cardWidth = 448;
  vi.spyOn(card, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, cardWidth, 200),
  );
  const pane = document.createElement('section');
  let paneWidth = 1000;
  Object.defineProperty(pane, 'clientWidth', { get: () => paneWidth });
  document.body.append(card, pane);
  const [active, setActive] = createSignal(false);
  let padding: (() => number) | undefined;
  const view = render(() => {
    padding = createWalkPadding(
      () => pane,
      active,
      () => card,
    );
    return null;
  });
  expect(required(padding)()).toBe(0);
  setActive(true);
  expect(observe).toHaveBeenCalledWith(card);
  expect(observe).toHaveBeenCalledWith(pane);
  expect(required(padding)()).toBe(456);
  // Compact cards and font/zoom changes must use the new measurement.
  cardWidth = 300;
  required(resize)();
  expect(required(padding)()).toBe(308);
  paneWidth = 691;
  required(resize)();
  expect(required(padding)()).toBe(0);
  paneWidth = 692;
  required(resize)();
  expect(required(padding)()).toBe(308);
  setActive(false);
  expect(required(padding)()).toBe(0);
  expect(disconnect).toHaveBeenCalledOnce();
  view.unmount();
  card.remove();
  pane.remove();
});

test('padding follows a replacement card during the same walk', () => {
  const disconnect = vi.fn();
  const observe = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = observe;
      disconnect = disconnect;
    },
  );
  const pane = document.createElement('section');
  Object.defineProperty(pane, 'clientWidth', { value: 1200 });
  const first = document.createElement('div');
  const second = document.createElement('div');
  vi.spyOn(first, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 448, 200));
  vi.spyOn(second, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 200));
  const [card, setCard] = createSignal<HTMLElement | undefined>(first);
  let padding: (() => number) | undefined;
  const view = render(() => {
    padding = createWalkPadding(
      () => pane,
      () => true,
      card,
    );
    return null;
  });
  expect(required(padding)()).toBe(456);
  setCard(second);
  expect(disconnect).toHaveBeenCalledOnce();
  expect(observe).toHaveBeenCalledWith(second);
  expect(required(padding)()).toBe(308);
  setCard(undefined);
  expect(required(padding)()).toBe(0);
  view.unmount();
});
