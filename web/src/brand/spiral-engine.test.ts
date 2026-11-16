import { expect, test } from 'vitest';
import { baseSpiral, MOTION, shape, STATES } from './spiral-engine.ts';

test('the sampled rest path is deterministic and all four states are available', () => {
  const base = baseSpiral();
  const rest = shape(base, MOTION.static(0));
  expect(rest.startsWith('M46.98 17.10L')).toBe(true);
  expect(rest.match(/L/g)).toHaveLength(300);
  expect(shape(baseSpiral(), MOTION.static(0))).toBe(rest);
  expect(STATES).toEqual(['static', 'thinking', 'hold', 'error']);
});
test('thinking and hold deform the line over time', () => {
  const base = baseSpiral();
  for (const state of ['thinking', 'hold'] as const) {
    expect(shape(base, MOTION[state](0))).not.toBe(shape(base, MOTION[state](0.5)));
  }
});
