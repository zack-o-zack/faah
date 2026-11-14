import { join } from 'node:path';
import { fixture } from '../../test/contract/fixtures.ts';
import { launch } from '../../bench/launch.ts';
import { ready } from '../../bench/http.ts';
import { propagation } from '../../bench/stream.ts';
import { fixtures } from '../../bench/scenarios.ts';
import { stats } from '../../bench/util.ts';
import { record, string, number } from '../src/decode.ts';

const go = process.env.FAAH_LEGACY_BIN,
  bun = process.env.FAAH_BIN;
if (!go || !bun) throw new Error('Set FAAH_LEGACY_BIN and FAAH_BIN');
const f = await fixture();
const rows: { runtime: string; round: number; name: string; samples: number[] }[] = [];
const streams: {
  runtime: string;
  round: number;
  results: Awaited<ReturnType<typeof propagation>>;
}[] = [];
try {
  for (let i = 0; i < 500; i++)
    await f.write(
      `generated/group-${i % 10}/file-${i}.ts`,
      `export function benchmarkFunction${i}() {\n` +
        '  return 42; // benchmark needle\n'.repeat(40) +
        '}\n',
    );
  f.git('add', '-A');
  f.git('commit', '-qm', 'Benchmark baseline');
  const head = f.git('rev-parse', 'HEAD');
  const selected = await fixtures(f.root);
  const original = await Bun.file(join(f.root, 'src/hello.go')).text();
  const streamFixture = { ...selected, modified: 'src/hello.go', original };
  const dirty = 'unstaged.txt';
  await f.write(dirty, 'benchmark change\n');
  const specs = [
    { name: 'git.refresh', route: 'api/git/refresh' },
    { name: 'diff', route: 'api/diff?path=' + dirty },
    { name: 'gutter', route: 'api/gutter?path=' + dirty },
    { name: 'log', route: 'api/git/log' },
    { name: 'commitdetail', route: 'api/commitdetail?sha=' + head },
    { name: 'meta', route: 'api/meta' },
    { name: 'tree', route: 'api/tree' },
    { name: 'find', route: 'api/find?q=hello' },
    { name: 'search', route: 'api/search?q=Hello' },
    { name: 'file.window', route: 'api/file?path=src/large.go&start=300&count=300' },
  ];
  for (let round = 0; round < 3; round++) {
    for (const [runtime, binary] of [
      ['Go', go],
      ['Bun', bun],
    ] as const) {
      const server = await launch(binary, f.root);
      try {
        await ready(server.baseUrl, server.started);
        const get = async (route: string, body?: unknown) => {
          const url = new URL(route, server.baseUrl),
            start = performance.now();
          const response = await fetch(url, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { Origin: url.origin, 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(30000),
          });
          const text = await response.text(),
            ms = performance.now() - start;
          const value: unknown = JSON.parse(text);
          if (!response.ok) throw new Error(route + ': ' + text);
          return { ms, value: record(value) };
        };
        for (const spec of specs) {
          const samples: number[] = [];
          for (let i = 0; i < 20; i++) {
            const { ms, value } = await get(spec.route);
            if (spec.name === 'git.refresh' && number(value.gitChanges) !== 1)
              throw new Error('bad status');
            if (['diff', 'gutter'].includes(spec.name) && value.available !== true)
              throw new Error('missing diff');
            if (spec.name === 'log' && (!Array.isArray(value.commits) || !value.commits.length))
              throw new Error('missing log');
            if (spec.name === 'commitdetail' && string(value.hash) !== head)
              throw new Error('bad detail');
            if (spec.name === 'meta' && (value.ready !== true || number(value.files) < 500))
              throw new Error('bad index');
            const field =
              spec.name === 'tree'
                ? 'children'
                : spec.name === 'find'
                  ? 'results'
                  : spec.name === 'file.window'
                    ? 'lines'
                    : '';
            if (field && (!Array.isArray(value[field]) || !value[field].length))
              throw new Error('empty ' + spec.name);
            if (spec.name === 'search' && number(value.total) < 1) throw new Error('empty search');
            if (i >= 5) samples.push(ms);
          }
          rows.push({ runtime, round, name: spec.name, samples });
        }
        const samples: number[] = [];
        for (let i = 0; i < 20; i++) {
          const start = performance.now();
          const stage = await get('api/git/stage', { path: dirty });
          if (record(stage.value.staged)[dirty] !== true) throw new Error('not staged');
          const unstage = await get('api/git/unstage', { path: dirty });
          if (unstage.value.staged !== undefined && record(unstage.value.staged)[dirty])
            throw new Error('still staged');
          if (i >= 5) samples.push(performance.now() - start);
        }
        rows.push({ runtime, round, name: 'stage.unstage', samples });
        // propagation() synchronizes on a dirty-to-clean transition before timing.
        await f.write(streamFixture.modified, original + '\n// initial dirty state\n');
        await get('api/git/refresh');
        const sse = await propagation(server.baseUrl, f.root, streamFixture, 4);
        if (sse.some((entry) => entry.timeouts)) throw new Error('SSE timeout');
        streams.push({ runtime, round, results: sse });
        process.stdout.write(JSON.stringify({ runtime, round, measured: rows.length, sse }) + '\n');
      } finally {
        await server.stop();
      }
    }
  }
  const summary = specs
    .map((s) => s.name)
    .concat('stage.unstage')
    .map((name) => {
      const go = stats(
        rows.filter((r) => r.name === name && r.runtime === 'Go').flatMap((r) => r.samples),
      );
      const bun = stats(
        rows.filter((r) => r.name === name && r.runtime === 'Bun').flatMap((r) => r.samples),
      );
      return { name, go, bun, ratio: bun.p50 / go.p50 };
    });
  const sse = ['save', 'external'].map((mode) => {
    const values = (runtime: string) =>
      streams
        .filter((r) => r.runtime === runtime)
        .flatMap((r) =>
          r.results.filter((s) => s.mode === mode).flatMap((s) => s.samples.map((v) => v.ms)),
        );
    const go = stats(values('Go')),
      bun = stats(values('Bun'));
    return { mode, go, bun, ratio: bun.p50 / go.p50 };
  });
  const result = {
    source: Bun.spawnSync(['git', 'rev-parse', 'HEAD']).stdout.toString().trim(),
    fixture: '500 generated files + contract repo',
    trackedFiles: f.git('ls-files').split('\n').length,
    rounds: 3,
    warmups: 5,
    requestsPerRound: 15,
    summary,
    sse,
    rows,
    streams,
  };
  await Bun.write(
    process.env.FAAH_GIT_BENCH_REPORT ?? '/tmp/faah-git-bench.json',
    JSON.stringify(result, null, 2) + '\n',
  );
  process.stdout.write(JSON.stringify({ summary, sse }) + '\n');
} finally {
  await f.cleanup();
}
