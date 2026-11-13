import { readFile } from 'node:fs/promises';
import { array, num, object, str } from './util.ts';

interface Metric {
  value: number;
  unit: string;
  higher: boolean;
}
export function metrics(value: unknown): Map<string, Metric> {
  const result = new Map<string, Metric>();
  const root = object(value);
  const add = (key: string, v: unknown, unit = 'ms', higher = false) =>
    result.set(key, { value: num(v), unit, higher });
  const latencies = (key: string, v: unknown) => {
    const row = object(v);
    for (const p of ['min', 'p50', 'p95', 'p99', 'mean']) add(`${key}.${p}`, row[p]);
  };
  add('binary.size', object(root.environment).binaryBytes, 'bytes');
  for (const entry of array(root.repos)) {
    const repo = object(entry);
    const name = str(repo.name);
    const startup = object(repo.startup);
    latencies(`${name}.startup.first`, startup.first);
    latencies(`${name}.startup.ready`, startup.ready);
    for (const entry of array(repo.latency)) {
      const row = object(entry);
      latencies(`${name}.${str(row.name)}`, row.latency);
    }
    for (const mode of ['cold', 'warm'])
      add(`${name}.file.${mode}`, object(object(repo.coldWarm)[mode]).ms);
    for (const entry of array(repo.sse)) {
      const row = object(entry);
      latencies(`${name}.sse.${str(row.mode)}`, row.latency);
      add(`${name}.sse.${str(row.mode)}.timeouts`, row.timeouts, 'count');
    }
    for (const entry of array(repo.throughput)) {
      const row = object(entry);
      const key = `${name}.throughput.C${num(row.concurrency)}`;
      add(key, row.requestsPerSecond, 'req/s', true);
      add(`${key}.errors`, row.errorCount, 'count');
      latencies(key, row.latency);
    }
    latencies(`${name}.under-load.meta`, object(object(repo.responsiveness).meta).latency);
    const memory = object(repo.memory);
    for (const field of ['readyBytes', 'peakBytes', 'idleBytes'])
      add(`${name}.rss.${field}`, memory[field], 'bytes');
  }
  if (root.workbench) {
    const wb = object(root.workbench);
    add('workbench.spawn', wb.spawnReadyMs);
    add('workbench.open', wb.openReadyMs);
    for (const mode of ['proxy', 'direct'])
      latencies(`workbench.${mode}`, object(wb[mode]).latency);
  }
  return result;
}
function format(metric: Metric): string {
  if (metric.unit === 'bytes') return `${(metric.value / 1048576).toFixed(2)} MiB`;
  return `${metric.value.toFixed(3)} ${metric.unit}`;
}
export function report(a: unknown, b?: unknown): string {
  const first = metrics(a);
  const second = b === undefined ? undefined : metrics(b);
  const label = str(object(object(a).environment).label);
  const other = b === undefined ? '' : str(object(object(b).environment).label);
  const lines = second
    ? [
        `| Metric | ${label} | ${other} | Delta % (b/a − 1) | Better |`,
        '| --- | ---: | ---: | ---: | --- |',
      ]
    : [`| Metric | ${label} |`, '| --- | ---: |'];
  for (const [key, metric] of first) {
    const next = second?.get(key);
    if (!second) lines.push(`| ${key} | ${format(metric)} |`);
    else if (next) {
      const delta = metric.value === 0 ? undefined : (next.value / metric.value - 1) * 100;
      let better = 'equal';
      if (next.value !== metric.value)
        better = next.value > metric.value === metric.higher ? other : label;
      lines.push(
        `| ${key} | ${format(metric)} | ${format(next)} | ${delta?.toFixed(2) ?? 'n/a'} | ${better} |`,
      );
    }
  }
  return lines.join('\n') + '\n';
}
if (import.meta.main) {
  const [a, b] = process.argv.slice(2);
  if (!a) throw new Error('Usage: bun bench/report.ts A.json [B.json]');
  const first: unknown = JSON.parse(await readFile(a, 'utf8'));
  const second: unknown = b ? JSON.parse(await readFile(b, 'utf8')) : undefined;
  console.log(report(first, second));
}
