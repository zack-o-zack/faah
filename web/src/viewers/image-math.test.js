import { test, expect } from 'vitest';
import { fitScale, zoomScale, panFrom, imageTransform } from './image-math.js';
test('fit respects padding, aspect ratio, missing metadata and small images', () => {
  expect(fitScale(2000, 1000, 1080, 900)).toBe(0.5);
  expect(fitScale(32, 32, 1080, 900)).toBe(1);
  expect(fitScale(0, 0, 0, 0)).toBe(1);
  expect(fitScale(2000, 1000, 0, 0)).toBe(0.05);
});
test('zoom bounds and drag coordinates are independent of screen origin', () => {
  expect(zoomScale(32, 1)).toBe(32);
  expect(zoomScale(0.05, -1)).toBe(0.05);
  expect(zoomScale(1, 1, 2)).toBe(2);
  expect(panFrom({ panX: 10, panY: -10 }, { x: 30, y: 40 }, { x: 50, y: 10 })).toEqual({
    panX: 30,
    panY: -40,
  });
});
test('transform derives the scale without copying fitted values into state', () => {
  expect(imageTransform({ fit: true, scale: 2, panX: 3, panY: 4 }, 0.5)).toBe(
    'translate(3px, 4px) scale(0.5)',
  );
});
