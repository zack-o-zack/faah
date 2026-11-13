import { readFile, writeFile } from 'node:fs/promises';
import { metrics, report } from './report.ts';
import { array, num, object, str } from './util.ts';
import { verify } from './verify.ts';

const [aPath, bPath, out] = process.argv.slice(2);
if (!aPath || !bPath || !out) throw new Error('Usage: bun bench/summary.ts A.json B.json OUT.md');
const a: unknown = JSON.parse(await readFile(aPath, 'utf8'));
const b: unknown = JSON.parse(await readFile(bPath, 'utf8'));
const checked = [...verify(a), ...verify(b)];
const rows = metrics(a);
function value(key: string): number {
  const row = rows.get(key);
  if (!row) throw new Error(`Missing metric: ${key}`);
  return row.value;
}
const lines = [
  '# Go baseline',
  '',
  `Backend source: ${str(object(object(a).environment).gitCommit)}. Binary: ${(value('binary.size') / 1048576).toFixed(2)} MiB.`,
  '',
  'Two sequential full runs. Headline values below use run A. Startup is median index-ready time over five launches; request values are p50 for find.0, literal common search, and the large-file first window. RSS is process-tree MiB. SSE is save / external edit. Rates use the mixed workload at C=8.',
  '',
  '| Repository | Startup ready ms | Find / search / file ms | SSE save / external ms | C=8 req/s | RSS ready / peak / idle MiB |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
];
for (const entry of array(object(a).repos)) {
  const name = str(object(entry).name);
  const v = (metric: string) => value(`${name}.${metric}`).toFixed(2);
  const mem = (metric: string) => (value(`${name}.rss.${metric}Bytes`) / 1048576).toFixed(1);
  lines.push(
    `| ${name} | ${v('startup.ready.p50')} | ${v('find.0.p50')} / ${v('search.common.p50')} / ${v('file.large.p50')} | ${v('sse.save.p50')} / ${v('sse.external.p50')} | ${v('throughput.C8')} | ${mem('ready')} / ${mem('peak')} / ${mem('idle')} |`,
  );
}
lines.push(
  '',
  '## Observations',
  '',
  'Metadata is substantially slower than fuzzy find in this baseline. Metadata includes forge credential resolution (which can invoke `gh auth token`) and process metrics; it is not a pure router/JSON measurement. Under four regex-search clients, its tail latency rises further. These are endpoint totals, not a profile of one subsystem.',
  '',
  'The large transient RSS peaks count the full descendant process tree and can include shared pages in more than one process. Go also explicitly scavenges idle render memory and invokes `debug.FreeOSMemory`; much lower idle RSS is expected. These figures should not be interpreted as unique heap allocation.',
  '',
  'The Go executable was built with CGO_ENABLED=0, -trimpath and -ldflags="-s -w" after npm run build. Its embedded VCS revision is c32fe4e; its dirty marker is caused by the added benchmark directory. Existing tracked backend/frontend files were not edited.',
  '',
  'The separate Go microbenchmark baseline covers 28 names, three samples each: [parsed JSON](go-micro-c32fe4e.json), [raw output](go-micro-c32fe4e.txt). Inputs and methodology are documented in [the harness README](../README.md).',
);
lines.push('', '## Validation', '', ...checked.map((note) => `- ${note}`));
lines.push(
  '',
  '## Run-to-run variation for every metric',
  '',
  'Delta is `(B/A − 1) × 100%`. With the same implementation, these differences are observed noise and state effects, not evidence of an implementation speedup. Small sub-millisecond metrics can show large percentages. p99 from 30 samples is the maximum; interpret it with care. Truncated common searches can return different capped counts because concurrent search workers race to the cap. The raw request counts and byte sizes make that work visible. A zero denominator is shown as n/a.',
  '',
  report(a, b),
);
lines.push(
  '## Environment',
  '',
  'Run A:',
  '',
  '```json',
  JSON.stringify(object(a).environment, null, 2),
  '```',
  '',
  'Run B:',
  '',
  '```json',
  JSON.stringify(object(b).environment, null, 2),
  '```',
  '',
);
// Keep the output deterministic: no generation-time timestamp beyond those recorded by the runs.
await writeFile(out, lines.join('\n'));
console.log(`Wrote ${out}; ${num(object(object(a).environment).binaryBytes)} binary bytes`);
