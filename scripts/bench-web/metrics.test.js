import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSummaries, median, percentile, summarize, frameStats, aggregate, profileSelfTime, interactionDurations } from './metrics.js';

test('median interpolates, ignores nonfinite samples, and does not mutate inputs', () => {
  const samples = [9, 1, 3, 5, NaN, Infinity];
  assert.equal(median(samples), 4);
  assert.equal(samples[0], 9);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([]), null);
});
test('nearest-rank percentile preserves small-sample tails', () => {
  assert.equal(percentile([1, 2, 3, 4, 100]), 100);
  assert.equal(percentile(Array.from({ length: 100 }, (_, i) => i + 1)), 95);
  assert.equal(percentile([4], 0), 4);
  assert.equal(percentile([]), null);
  assert.throws(() => percentile([1], 1.1), RangeError);
});
test('frame threshold and empty samples are explicit', () => {
  assert.deepEqual(summarize([]), { count: 0, median: null, p95: null });
  assert.equal(frameStats([16.6, 16.7, 16.8, 33.4]).dropped, 2);
  assert.equal(frameStats([16.700000000001]).dropped, 0);
});
test('Event Timing groups related entries and excludes non-interaction events', () => {
  assert.deepEqual(interactionDurations([
    { interactionId: 1, duration: 24 }, { interactionId: 1, duration: 16 },
    { interactionId: 0, duration: 99 }, { interactionId: 2, duration: 32 },
  ]), [24, 32]);
});
test('aggregation pools per-action samples across runs', () => {
  assert.deepEqual(aggregate([
    { metrics: { latency: { unit: 'ms', samples: [1, 3] } } },
    { metrics: { latency: { unit: 'ms', samples: [9] } } },
  ]), { latency: { unit: 'ms', count: 3, median: 3, p95: 9 } });
});
test('CPU profile uses sample time deltas and aggregates identical call frames', () => {
  const frame = name => ({ functionName: name, url: '/app.js', lineNumber: 0, columnNumber: 0 });
  const top = profileSelfTime({ nodes: [
    { id: 1, callFrame: frame('slow') }, { id: 2, callFrame: frame('fast') },
    { id: 3, callFrame: frame('slow') },
  ], samples: [1, 2, 3], timeDeltas: [4000, 1000, 5000] });
  assert.equal(top[0].name, 'slow');
  assert.equal(top[0].selfMs, 9);
  assert.equal(top[0].percent, 90);
  assert.equal(top[1].selfMs, 1);
});

test('optional comparison matches units and handles zero, empty and missing medians', () => {
  const current = { time: { unit: 'ms', median: 8 }, zero: { unit: 'bytes', median: 3 },
    missing: { unit: 'ms', median: 2 }, empty: { unit: 'ms', median: null },
    units: { unit: 'ms', median: 1 } };
  assert.deepEqual(compareSummaries(current, { time: { unit: 'ms', median: 10 },
    zero: { unit: 'bytes', median: 0 }, empty: { unit: 'ms', median: 1 },
    units: { unit: 'bytes', median: 1 } }), {
    time: { unit: 'ms', baseline: 10, current: 8, delta: -2, percent: -20 },
    zero: { unit: 'bytes', baseline: 0, current: 3, delta: 3, percent: null },
  });
  assert.deepEqual(compareSummaries({}, {}), {});
  assert.throws(() => compareSummaries({}, null), /Invalid baseline/);
  assert.throws(() => compareSummaries({}, { broken: { unit: 'ms', median: 'bad' } }), /Invalid baseline/);
});
