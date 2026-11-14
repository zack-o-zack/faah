import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { find, newItem, score } from '../src/fuzzy/score.ts';
import { FuzzyPool } from '../src/fuzzy/pool.ts';
import { IgnoreSet, compilePattern } from '../src/ignore/service.ts';
import { familyFor, declPatterns, outline, indentCols } from '../src/symbols/service.ts';
import { generateItems, fuzzyPaths, goOutline, markdownOutline } from './vectors.ts';
import { record, number, string } from '../src/decode.ts';

const root = await mkdtemp(join(tmpdir(), 'faah-micro-'));
const pool = new FuzzyPool();
const benchmarks: {
  name: string;
  nsPerOp: number;
  samples: number[];
  goNsPerOp: number | undefined;
}[] = [];
const baseline = record(
  JSON.parse(
    await readFile(join(import.meta.dir, '../../bench/results/go-micro-c32fe4e.json'), 'utf8'),
  ),
);
if (!Array.isArray(baseline.benchmarks)) throw new Error('invalid Go baseline');
const go = new Map(
  baseline.benchmarks.map((row) => {
    const b = record(row);
    return [string(b.name).split('/').at(-1) ?? '', number(b.nsPerOp)];
  }),
);
// Three timed samples; calibration and setup are outside the measured loops.
async function measure(name: string, run: (i: number) => unknown) {
  for (let i = 0; i < 100; i++) run(i);
  const start = performance.now();
  for (let i = 0; i < 1000; i++) run(i);
  const elapsed = performance.now() - start;
  const count = Math.min(5000000, Math.max(10, Math.ceil((300 / Math.max(elapsed, 0.001)) * 1000)));
  const samples: number[] = [];
  for (let sample = 0; sample < 3; sample++) {
    const start = performance.now();
    for (let i = 0; i < count; i++) run(i);
    samples.push(((performance.now() - start) * 1e6) / count);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const result = { name, nsPerOp: sorted[1] ?? 0, samples, goNsPerOp: go.get(name) };
  benchmarks.push(result);
  process.stdout.write(JSON.stringify(result) + '\n');
}
async function measureAsync(name: string, run: () => Promise<unknown>) {
  for (let i = 0; i < 10; i++) await run();
  const samples: number[] = [];
  for (let sample = 0; sample < 3; sample++) {
    const start = performance.now();
    let count = 0;
    do {
      await run();
      count++;
    } while (performance.now() - start < 300);
    samples.push(((performance.now() - start) * 1e6) / count);
  }
  const result = {
    name,
    nsPerOp: [...samples].sort((a, b) => a - b)[1] ?? 0,
    samples,
    goNsPerOp: go.get(name),
  };
  benchmarks.push(result);
  process.stdout.write(JSON.stringify(result) + '\n');
}
try {
  const items = fuzzyPaths.map((p) => newItem(p));
  await measure('BenchmarkFuzzyFind', () => find(items, 'httpserver', 5));
  const item = newItem('internal/server/http_server.go'),
    query = Buffer.from('httpserver');
  await measure('BenchmarkScore', () => score({ item, query, original: query }));
  for (const [name, n, query] of [
    ['BenchmarkFuzzyFind_1K', 1000, 'handler'],
    ['BenchmarkFuzzyFind_10K', 10000, 'handler'],
    ['BenchmarkFuzzyFind_50K', 50000, 'srvutil'],
    ['BenchmarkFuzzyFindShortQuery_50K', 50000, 'in'],
  ] as const) {
    await pool.set(generateItems(n));
    await measureAsync(name, () => pool.find(query, 50));
  }
  const ignore = new IgnoreSet([
    'build/',
    '*.tmp',
    '!keep.tmp',
    'docs/**/draft.md',
    '/only-root.txt',
    'node_modules/',
    'vendor/',
  ]);
  const paths = [
    'src/main.go',
    'build/out.js',
    'a/b/keep.tmp',
    'docs/x/y/draft.md',
    'sub/only-root.txt',
    'vendor/pkg/foo.go',
  ];
  await measure('BenchmarkIgnoreMatch', (i) => ignore.match(paths[i % paths.length] ?? '', false));
  const patterns = ['build/', '*.tmp', 'docs/**/draft.md', '/only-root.txt', 'node_modules/'];
  await measure('BenchmarkCompilePattern', (i) =>
    compilePattern(patterns[i % patterns.length] ?? ''),
  );
  const exts = ['.go', '.py', '.ts', '.rs', '.c', '.rb', '.java', '.sh', '.php', '.txt'];
  await measure('BenchmarkFamilyFor', (i) => familyFor(exts[i % exts.length] ?? ''));
  await measure('BenchmarkDeclPatterns', () => declPatterns('ProcessRequest'));
  await writeFile(join(root, 'bench.go'), goOutline);
  await writeFile(join(root, 'bench.md'), markdownOutline);
  await measureAsync('BenchmarkOutlineGo', () => outline(join(root, 'bench.go'), 'bench.go'));
  await measureAsync('BenchmarkOutlineMarkdown', () => outline(join(root, 'bench.md'), 'bench.md'));
  await measure('BenchmarkIndentCols', () => indentCols('    \t  \t'));
  await Bun.write(
    process.env.FAAH_MICRO_REPORT ?? '/tmp/faah-phase2-micro.json',
    JSON.stringify(
      { runtime: Bun.version, timestamp: new Date().toISOString(), benchmarks },
      null,
      2,
    ) + '\n',
  );
} finally {
  pool.close();
  await rm(root, { recursive: true, force: true });
}
