import { array, now, num, object, stats, str } from './util.ts';

export interface Spec {
  name: string;
  route: string;
  params?: Record<string, string>;
}
export interface Sample {
  ms: number;
  status: number;
  bytes: number;
  count: number;
  counts: Record<string, number | boolean>;
}
function countsFor(route: string, value: unknown): Record<string, number | boolean> {
  const body = object(value);
  const endpoint = route.split('/').pop();
  switch (endpoint) {
    case 'meta':
      return { count: num(body.files), ready: body.ready === true };
    case 'tree':
      return { count: array(body.children).length };
    case 'find':
      return { count: array(body.results).length, indexing: body.indexing === true };
    case 'search':
      return { count: num(body.total), files: num(body.files), truncated: body.truncated === true };
    case 'file':
      return { count: array(body.lines).length, total: num(body.total) };
    case 'markdown':
      return { count: str(body.html).length };
    case 'outline':
      return { count: array(body.symbols).length };
    case 'def':
      return { count: array(body.defs).length };
    case 'refresh':
      return { count: num(body.gitChanges) };
    case 'diff':
      return { count: array(body.hunks ?? []).length, available: body.available === true };
    case 'gutter':
      return {
        count:
          array(body.added ?? []).length +
          array(body.modified ?? []).length +
          array(body.deleted ?? []).length,
        available: body.available === true,
      };
    case 'table':
      return {
        count: array(body.rows).length,
        cols: num(body.cols),
        truncated: body.truncated === true,
      };
    case 'save':
      return { count: num(body.size) };
    case 'open':
      return { count: 1 };
    default:
      throw new Error(`No count decoder for ${route}`);
  }
}
export async function request(
  base: string,
  spec: Spec,
  body?: unknown,
): Promise<{ sample: Sample; value: unknown }> {
  const url = new URL(spec.route, base);
  for (const [key, value] of Object.entries(spec.params ?? {})) url.searchParams.set(key, value);
  const started = now();
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Host: url.host, Origin: url.origin, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const ms = now() - started;
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!response.ok)
    throw new Error(`${spec.name}: HTTP ${response.status} ${JSON.stringify(value)}`);
  const counts = countsFor(spec.route, value);
  const sample = {
    ms,
    status: response.status,
    bytes: bytes.length,
    count: num(counts.count),
    counts,
  };
  return { sample, value };
}
export async function measure(base: string, spec: Spec, iterations: number) {
  for (let i = 0; i < 5; i++) await request(base, spec);
  const samples: Sample[] = [];
  for (let i = 0; i < iterations; i++) samples.push((await request(base, spec)).sample);
  return { ...spec, latency: stats(samples.map((s) => s.ms)), samples };
}
export async function ready(base: string, started: number) {
  let firstMs: number | undefined;
  const samples: Sample[] = [];
  while (now() - started < 180000) {
    try {
      const response = await request(base, { name: 'startup.meta', route: 'api/meta' });
      samples.push(response.sample);
      firstMs ??= now() - started;
      if (object(response.value).ready === true)
        return { firstMs, readyMs: now() - started, samples };
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Index readiness timeout');
}
