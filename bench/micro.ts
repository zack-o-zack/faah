import { cpus, availableParallelism, platform, release } from 'node:os';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { command, stats } from './util.ts';
import { corpus } from './corpus.ts';
import { flags } from './launch.ts';

const bin = process.argv[2];
if (!bin) throw new Error('Usage: bun bench/micro.ts /absolute/path/faah-go');
const commit = await command(['git', 'rev-parse', 'HEAD']);
const prefix = `bench/results/go-micro-${commit.slice(0, 7)}`;
const packages = [
  './internal/fuzzy',
  './internal/ignore',
  './internal/render',
  './internal/symbols',
  './internal/table',
];
const environment = {
  label: 'Go microbenchmarks',
  binary: bin,
  binaryBytes: (await stat(bin)).size,
  gitCommit: commit,
  os: `${platform()} ${release()}`,
  cpu: cpus()[0]?.model ?? 'unknown',
  cores: availableParallelism(),
  bun: Bun.version,
  go: await command(['go', 'version']),
  timestamp: new Date().toISOString(),
  corpus: await corpus(),
  flags,
  commands: [
    'go test -run=^$ -bench=. -benchmem -count=3 ' + packages.join(' '),
    'go test -run=^$ -bench=Search|Snip|HandleFile|SortNodes|GitStatus -benchmem -count=3 .',
  ],
};
let raw = '# Environment: ' + JSON.stringify(environment) + '\n';
for (const [targets, pattern] of [
  [packages, '.'],
  [['.'], 'Search|Snip|HandleFile|SortNodes|GitStatus'],
]) {
  if (!Array.isArray(targets) || typeof pattern !== 'string')
    throw new Error('Invalid benchmark command');
  console.log(`Running microbenchmarks: ${targets.join(', ')}`);
  raw +=
    (await command([
      'go',
      'test',
      '-run=^$',
      `-bench=${pattern}`,
      '-benchmem',
      '-count=3',
      ...targets,
    ])) + '\n';
  await writeFile(`${prefix}.txt`, raw);
}
const grouped = new Map<string, { ns: number[]; bytes: number[]; allocs: number[] }>();
let pkg = '';
for (const line of (await readFile(`${prefix}.txt`, 'utf8')).split('\n')) {
  if (line.startsWith('pkg: ')) pkg = line.slice(5);
  const match =
    /^(Benchmark\S+)-\d+\s+\d+\s+([\d.]+) ns\/op\s+([\d.]+) B\/op\s+([\d.]+) allocs\/op/.exec(line);
  if (!match) continue;
  const [, name, ns, bytes, allocs] = match;
  if (!name || !ns || !bytes || !allocs) throw new Error('Incomplete benchmark line');
  const key = `${pkg}/${name}`;
  const group = grouped.get(key) ?? { ns: [], bytes: [], allocs: [] };
  group.ns.push(Number(ns));
  group.bytes.push(Number(bytes));
  group.allocs.push(Number(allocs));
  grouped.set(key, group);
}
const benchmarks = [...grouped].map(([name, values]) => {
  if (values.ns.length !== 3) throw new Error(`Expected 3 samples: ${name}`);
  return {
    name,
    nsPerOp: stats(values.ns).p50,
    bytesPerOp: stats(values.bytes).p50,
    allocsPerOp: stats(values.allocs).p50,
    samples: values,
  };
});
if (!benchmarks.length) throw new Error('No microbenchmarks parsed');
await writeFile(
  `${prefix}.json`,
  JSON.stringify({ schemaVersion: 1, environment, benchmarks }, null, 2) + '\n',
);
