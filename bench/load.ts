import { request } from './http.ts';
import type { Spec } from './http.ts';
import { now, stats } from './util.ts';

// Tuples keep every response auditable without repeating field names per request.
export type LoadSample = [
  scenario: number,
  ms: number,
  status: number,
  bytes: number,
  count: number,
];
export async function load(base: string, specs: Spec[], concurrency: number, seconds: number) {
  const samples: LoadSample[] = [];
  const errors: string[] = [];
  const started = now();
  const deadline = started + seconds * 1000;
  async function worker(offset: number) {
    let i = offset;
    while (now() < deadline) {
      const index = i++ % specs.length;
      const spec = specs[index];
      if (!spec) throw new Error('Empty workload');
      try {
        const { sample: s } = await request(base, spec);
        samples.push([index, s.ms, s.status, s.bytes, s.count]);
      } catch (error) {
        errors.push(String(error));
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
  const elapsedMs = now() - started;
  return {
    concurrency,
    elapsedMs,
    requestsPerSecond: samples.length / (elapsedMs / 1000),
    latency: stats(samples.map((s) => s[1])),
    errorCount: errors.length,
    errors,
    specs,
    samples,
  };
}
export async function responsiveness(base: string, heavy: Spec, seconds: number) {
  const background = load(base, [heavy], 4, seconds);
  const foreground = load(base, [{ name: 'meta', route: 'api/meta' }], 1, seconds);
  const [search, meta] = await Promise.all([background, foreground]);
  return { search, meta };
}
