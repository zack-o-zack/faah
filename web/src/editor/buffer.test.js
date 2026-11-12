import { test, expect, vi } from 'vitest';
import { createDocumentBuffer } from './buffer.js';
const chunk = (start = 0, lines = ['<b>hello</b>'], total = 50000) => ({
  start,
  lines,
  total,
  exact: true,
});

test('deduplicates chunk requests and keeps fifty thousand lines outside proxies', async () => {
  let resolve;
  const fetcher = vi.fn(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const model = createDocumentBuffer('big.js', { fetcher, ref: 'commit' });
  const first = model.loadChunk(0);
  const second = model.loadChunk(0);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][1]).toMatchObject({ ref: 'commit', count: 1000 });
  resolve(chunk());
  await Promise.all([first, second]);
  expect(model.lines).toHaveLength(50000);
  expect(model.text(0)).toBe('hello');
  expect(model.columns[0]).toBe(5);
  expect(model.revision()).toBe(1);
  await model.ensure(0, 20);
  expect(fetcher).toHaveBeenCalledOnce();
  model.dispose();
});
test('reset aborts pending requests and ignores late responses', async () => {
  let resolve;
  let signal;
  const fetcher = vi.fn((_, params, options) => {
    signal = options.signal;
    return new Promise((done) => {
      resolve = done;
    });
  });
  const model = createDocumentBuffer('late.js', { fetcher });
  const pending = model.loadChunk(0);
  model.reset();
  expect(signal.aborted).toBe(true);
  resolve(chunk());
  await pending;
  expect(model.lines).toHaveLength(0);
  expect(model.pending.size).toBe(0);
  model.dispose();
});
test('failed windows can retry and disposal clears refine timers', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(chunk());
  const model = createDocumentBuffer('retry.js', { fetcher });
  await expect(model.loadChunk(0)).rejects.toThrow('offline');
  await model.loadChunk(0);
  model.refine(0);
  model.dispose();
  await vi.runAllTimersAsync();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(model.lines).toHaveLength(0);
  vi.useRealTimers();
});

test('wrap measurements invalidate offsets and expire when geometry changes', () => {
  const model = createDocumentBuffer('wrapped.js');
  model.apply(chunk(0, ['long wrapped line', 'short'], 2));
  const options = { wrap: true, width: 80, charWidth: 8 };
  model.layout(options);
  model.measureHeights([[0, 60]]);
  expect([...model.layout(options)]).toEqual([0, 60, 80]);
  expect([...model.layout({ ...options, width: 800 })]).toEqual([0, 20, 40]);
  model.dispose();
});

test('refinement retries inexact results and stops once exact', async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({ ...chunk(), exact: false, refine: true })
    .mockResolvedValueOnce({ ...chunk(0, ['first refinement']), exact: false })
    .mockResolvedValueOnce(chunk(0, ['exact refinement']));
  const model = createDocumentBuffer('refine.js', { fetcher });
  try {
    await model.loadChunk(0);
    await vi.runAllTimersAsync();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(model.text(0)).toBe('exact refinement');
    expect(model.refining.size).toBe(0);
  } finally {
    model.dispose();
    vi.useRealTimers();
  }
});

test('a late old request cannot delete a new request for the same chunk', async () => {
  const pending = [];
  const model = createDocumentBuffer('generation.js', {
    fetcher: () => new Promise((resolve) => pending.push(resolve)),
  });
  const old = model.loadChunk(0);
  model.reset();
  const next = model.loadChunk(0);
  pending[0](chunk(0, ['stale']));
  await old;
  expect(model.pending.size).toBe(1);
  pending[1](chunk(0, ['current']));
  await next;
  expect(model.text(0)).toBe('current');
  expect(model.pending.size).toBe(0);
  model.dispose();
});
