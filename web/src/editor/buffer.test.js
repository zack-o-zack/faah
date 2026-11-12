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
