import { appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { walk } from '../src/index/walk.ts';
import { Search } from '../src/search/service.ts';
import { pattern } from '../src/search/pattern.ts';
import { runRG } from '../src/search/rg.ts';
import { walkGlobs } from '../src/search/walk.ts';
import { find } from '../src/fuzzy/score.ts';
import { FuzzyPool } from '../src/fuzzy/pool.ts';
import { generateItems } from './vectors.ts';
import { rawFile, rawHeaders } from '../src/files/service.ts';
import { content } from '../src/http/content.ts';
import { launch } from '../../bench/launch.ts';
import { ready, request } from '../../bench/http.ts';
import { cloneWorkspace, stats } from '../../bench/util.ts';
import { fixtures } from '../../bench/scenarios.ts';

const output = process.env.FAAH_PROFILE_REPORT ?? '/tmp/faah-perf-profile.jsonl';
function report(value: Record<string, unknown>): void {
  const text = JSON.stringify(value) + '\n';
  appendFileSync(output, text);
  process.stdout.write(text);
}
const option = (name: string) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const binary = option('--bin');
const signal = AbortSignal.timeout(600000);
for (const name of (option('--repos') ?? 'flask,kubernetes').split(',')) {
  const workspace = await cloneWorkspace(join(homedir(), '.cache/faah-bench/repos', name));
  try {
    const cpu = process.cpuUsage(),
      start = performance.now();
    const index = await walk({
      root: workspace.dir,
      publish: () => {},
      profile: (profile) => report({ type: 'walk-body', name, ...profile }),
    });
    report({
      type: 'walk',
      name,
      wallMs: performance.now() - start,
      cpu: process.cpuUsage(cpu),
      files: index.files.length,
    });
    const excluded = [...index.children.values()].flatMap((kids) => kids.filter((n) => n.ignored));
    const search = new Search({
      root: workspace.dir,
      files: () => index.files,
      excluded: () => excluded,
      profile: (profile) => report({ type: 'service', name, ...profile }),
    });
    for (let i = 0; i < 3; i++) {
      await search.search({ query: 'zzFAAH_NO_MATCH_9c71zz' }, signal);
      await search.definitions(name === 'flask' ? '__init__' : 'SwaggerDoc', signal);
    }
    const files = index.files.filter((f) => f.size > 0 && f.size <= 8 * 1024 * 1024);
    const globs = walkGlobs({ files, source: index.files, excluded }) ?? [];
    const expressions = [
      { label: 'current', expression: pattern({ query: 'zzFAAH_NO_MATCH_9c71zz' }) },
      { label: 'native-ascii', expression: '(?i-u)zzFAAH_NO_MATCH_9c71zz' },
      { label: 'definition', expression: pattern({ query: 'SwaggerDoc', word: true, case: true }) },
    ];
    for (const variant of expressions)
      for (const threads of [1, 4])
        for (let i = 0; i < 3; i++) {
          await runRG({
            root: workspace.dir,
            args: [
              '--json',
              '--text',
              '--hidden',
              '--no-ignore',
              '--no-config',
              '--threads',
              String(threads),
              ...globs,
              '-e',
              variant.expression,
              '--',
              '.',
            ],
            signal,
            match: async () => {},
            profile: (profile) =>
              report({ type: 'rg', name, variant: variant.label, threads, ...profile }),
          });
        }
    if (binary) {
      // Direct rg trials warm the first clone. HTTP gets a fresh copy, like the
      // shared benchmark, so those trials cannot hide a cold serial-walk cost.
      const httpWorkspace = await cloneWorkspace(join(homedir(), '.cache/faah-bench/repos', name));
      try {
        const fixture = await fixtures(httpWorkspace.dir);
        const server = await launch(resolve(binary), httpWorkspace.dir);
        try {
          await ready(server.baseUrl, server.started);
          for (const stage of ['before-render', 'after-render']) {
            if (stage === 'after-render') {
              await request(server.baseUrl, {
                name: 'render',
                route: 'api/file',
                params: { path: fixture.large, start: '0', count: '1000' },
              });
              for (const q of fixture.findQueries)
                await request(server.baseUrl, { name: 'find', route: 'api/find', params: { q } });
            }
            for (let i = 0; i < 3; i++) {
              const nohit = await request(server.baseUrl, {
                name: 'search.no-hit',
                route: 'api/search',
                params: { q: 'zzFAAH_NO_MATCH_9c71zz' },
              });
              const def = await request(server.baseUrl, {
                name: 'def',
                route: 'api/def',
                params: { sym: fixture.symbol },
              });
              const common = await request(server.baseUrl, {
                name: 'search.common',
                route: 'api/search',
                params: { q: 'return' },
              });
              report({
                type: 'http',
                name,
                stage,
                nohitMs: nohit.sample.ms,
                defMs: def.sample.ms,
                commonMs: common.sample.ms,
              });
            }
          }
        } finally {
          await server.stop();
        }
      } finally {
        await httpWorkspace.cleanup();
      }
    }
    const small = index.files.find((f) => f.size > 4000 && f.size < 24000);
    if (small) {
      const phases = { read: 0, headers: 0, response: 0 };
      const request = new Request('http://localhost/api/raw');
      for (let i = 0; i < 100; i++) {
        const start = performance.now(),
          file = await rawFile(workspace.dir, small.path);
        const read = performance.now(),
          headers = rawHeaders(file.rel),
          built = performance.now();
        const response = content({ bytes: file.bytes, request, headers, modified: file.modified });
        await response.arrayBuffer();
        phases.read += read - start;
        phases.headers += built - read;
        phases.response += performance.now() - built;
      }
      report({
        type: 'raw',
        name,
        perCallMs: Object.fromEntries(Object.entries(phases).map(([k, v]) => [k, v / 100])),
      });
    }
  } finally {
    await workspace.cleanup();
  }
}
for (const size of [1000, 10000, 26289, 50000]) {
  const items = generateItems(size),
    pool = new FuzzyPool();
  try {
    await pool.set(items);
    for (const query of ['handler', 'in', 'zzFAAH_NO_MATCH_9c71zz'])
      for (const mode of ['sync', 'workers']) {
        const samples: number[] = [];
        for (let i = 0; i < 40; i++) {
          const start = performance.now();
          if (mode === 'sync') find(items, query, 50);
          else await pool.find(query, 50);
          if (i >= 10) samples.push(performance.now() - start);
        }
        report({ type: 'fuzzy', size, query, mode, latency: stats(samples) });
      }
  } finally {
    pool.close();
  }
}
for (let i = 0; i < 20; i++)
  await runRG({
    root: process.cwd(),
    args: ['--json', '-e', 'zz-no-hit', '--', '-'],
    signal,
    match: async () => {},
    profile: (profile) => report({ type: 'spawn-floor', ...profile }),
  });
