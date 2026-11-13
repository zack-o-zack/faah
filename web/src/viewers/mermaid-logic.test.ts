import { expect, test } from 'vitest';
import { diagramDimensions, diagramFit, diagramZoom } from './mermaid-logic.ts';

test('diagram sizing uses the SVG viewBox and safe fallbacks', () => {
  expect(diagramDimensions('<svg width="100%" viewBox="-8 -8 1200 600"><g/></svg>')).toEqual({
    width: 1200,
    height: 600,
  });
  expect(diagramDimensions('<svg width="200px" height="80"><g/></svg>')).toEqual({
    width: 200,
    height: 80,
  });
  expect(diagramDimensions('<svg viewBox="NaN 0 -1 0"/>')).toEqual({ width: 600, height: 400 });
});

test('diagram fit constrains width inline and both axes in fullscreen without upscaling', () => {
  const natural = { width: 1200, height: 800 };
  expect(diagramFit(natural, { width: 648, height: 448 }, false)).toBe(0.5);
  expect(diagramFit(natural, { width: 1248, height: 448 }, true)).toBe(0.5);
  expect(diagramFit(natural, { width: 2448, height: 1648 }, true)).toBe(1);
});

test('diagram zoom follows the existing steps and clamps at its limits', () => {
  expect(diagramZoom(1, 1)).toBe(1.25);
  expect(diagramZoom(1, -1)).toBe(0.8);
  expect(diagramZoom(0.2, -1)).toBe(0.25);
  expect(diagramZoom(4, 1)).toBe(4);
});
