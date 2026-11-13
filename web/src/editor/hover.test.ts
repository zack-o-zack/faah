import { test, expect } from 'vitest';
import { nearCard, placeCard } from './hover.ts';
test('hover placement stays inside the host and flips above the anchor', () => {
  expect(
    placeCard(
      { x: 195, y: 195 },
      { left: 0, top: 0, width: 200, height: 200 },
      { width: 100, height: 100 },
    ),
  ).toEqual({ left: 88, top: 83 });
});
test('hover corridor keeps slow pointer travel to the card open', () => {
  const rect = { left: 200, right: 400, top: 100, bottom: 300 };
  const anchor = { x: 100, y: 50 };
  expect(nearCard({ x: 150, y: 70 }, anchor, rect)).toBe(true);
  expect(nearCard({ x: 395, y: 305 }, null, rect)).toBe(true);
  expect(nearCard({ x: 600, y: 500 }, anchor, rect)).toBe(false);
  expect(nearCard(null, anchor, rect)).toBe(false);
});
