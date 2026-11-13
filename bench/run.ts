import { stat, writeFile } from 'node:fs/promises';
import { availableParallelism, cpus, platform, release } from 'node:os';
import { join, resolve } from 'node:path';
import { cache, corpus } from './corpus.ts';
import { measure, ready, request } from './http.ts';
import { flags, launch, rss } from './launch.ts';
import { load, responsiveness } from './load.ts';
import { fixtures, modify, scenarios, workspaceId } from './scenarios.ts';
import { propagation } from './stream.ts';
import { cloneWorkspace, command, now, object, sleep, stats } from './util.ts';

const args = process.argv.slice(2);
function option(name: string): string | undefined {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
}
const binArg = option('--bin');
const output = option('--out');
const label = option('--label');
if (!binArg || !output || !label)
  throw new Error(
    'Usage: bun bench/run.ts --bin PATH --label NAME [--repos flask,redis,react,kubernetes] [--quick] --out FILE',
  );
const bin = resolve(binArg);
const quick = args.includes('--quick');
const iterations = quick ? 5 : 30;
const seconds = quick ? 2 : 10;
const repos = (await corpus()).filter(
  (repo) => !option('--repos') || option('--repos')?.split(',').includes(repo.name),
);
if (!repos.length) throw new Error('No pinned repositories selected; run bun bench/corpus.ts');
const environment = {
  label,
  binary: bin,
  binaryBytes: (await stat(bin)).size,
  gitCommit: await command(['git', 'rev-parse', 'HEAD']),
  os: `${platform()} ${release()}`,
  cpu: cpus()[0]?.model ?? 'unknown',
  cores: availableParallelism(),
  bun: Bun.version,
  go: await command(['go', 'version']),
  timestamp: new Date().toISOString(),
  corpus: repos,
  flags,
  quick,
  iterations,
  warmups: 5,
  startupLaunches: 5,
  throughputSeconds: seconds,
  idleSeconds: quick ? 10 : 60,
};
const results = [];
for (const repo of repos) {
  console.log(`Starting ${repo.name}`);
  const startup = [];
  for (let i = 0; i < 5; i++) {
    const workspace = await cloneWorkspace(join(cache, repo.name));
    try {
      const server = await launch(bin, workspace.dir);
      try {
        startup.push({
          ...(await ready(server.baseUrl, server.started)),
          rssBytes: await rss(server.pid),
        });
      } finally {
        await server.stop();
      }
    } finally {
      await workspace.cleanup();
    }
  }
  const workspace = await cloneWorkspace(join(cache, repo.name));
  try {
    // Fixture selection precedes spawn; reading fixture bytes is not included in server timings.
    const fixture = await fixtures(workspace.dir);
    const server = await launch(bin, workspace.dir);
    try {
      await ready(server.baseUrl, server.started);
      const readyBytes = await rss(server.pid);
      const memorySamples = [{ ms: 0, bytes: readyBytes }];
      const memoryStarted = now();
      let sampling = true;
      const sampler = (async () => {
        while (sampling) {
          const started = now();
          memorySamples.push({ ms: started - memoryStarted, bytes: await rss(server.pid) });
          await sleep(Math.max(0, 100 - (now() - started)));
        }
      })();
      try {
        const coldSpec = {
          name: 'file.cold',
          route: 'api/file',
          params: { path: fixture.large, start: '0', count: '1000' },
        };
        const cold = (await request(server.baseUrl, coldSpec)).sample;
        const warm = (await request(server.baseUrl, { ...coldSpec, name: 'file.warm' })).sample;
        await modify(workspace.dir, fixture);
        const specs = scenarios(fixture);
        const latency = [];
        for (const spec of specs) {
          console.log(`${repo.name}: ${spec.name}`);
          latency.push(await measure(server.baseUrl, spec, iterations));
        }
        const sse = await propagation(server.baseUrl, workspace.dir, fixture, quick ? 2 : 10);
        const mixed = specs.filter((s) =>
          ['meta', 'tree.root', 'find.0', 'file.large', 'search.common'].includes(s.name),
        );
        const throughput = [];
        for (const c of [1, 8, 32]) throughput.push(await load(server.baseUrl, mixed, c, seconds));
        const heavy = specs.find((s) => s.name === 'search.regex');
        if (!heavy) throw new Error('Missing heavy search');
        const underLoad = await responsiveness(server.baseUrl, heavy, seconds);
        sampling = false;
        await sampler;
        const peakBytes = Math.max(...memorySamples.map((s) => s.bytes));
        await sleep(environment.idleSeconds * 1000);
        const idleBytes = await rss(server.pid);
        results.push({
          name: repo.name,
          fixture: { ...fixture, original: undefined },
          startup: {
            samples: startup,
            first: stats(startup.map((s) => s.firstMs)),
            ready: stats(startup.map((s) => s.readyMs)),
          },
          coldWarm: { cold, warm },
          latency,
          skipped: fixture.csv ? [] : [{ scenario: 'table', reason: 'No tracked CSV' }],
          sse,
          throughput,
          responsiveness: underLoad,
          memory: { readyBytes, peakBytes, idleBytes, samples: memorySamples },
        });
      } finally {
        sampling = false;
        await sampler;
      }
    } finally {
      await server.stop();
    }
  } finally {
    await workspace.cleanup();
  }
  // Checkpoints survive interruption without presenting an incomplete file as complete.
  await writeFile(
    `${output}.partial`,
    JSON.stringify({ schemaVersion: 1, environment, repos: results }) + '\n',
  );
}
console.log('Starting workbench');
const flask = await cloneWorkspace(join(cache, 'flask'));
let workbench;
try {
  const desktop = await launch(bin);
  try {
    const openedAt = now();
    const opened = await request(
      desktop.baseUrl,
      { name: 'wb.open', route: 'api/wb/open' },
      { target: flask.dir },
    );
    const id = workspaceId(opened.value);
    const proxyBase = new URL(`w/${id}/`, desktop.baseUrl).href;
    // Workbench returns a holding HTML page until its child is listening.
    while (true) {
      const response = await fetch(new URL('api/meta', proxyBase));
      const text = await response.text();
      if (response.ok && text.startsWith('{')) {
        const value: unknown = JSON.parse(text);
        if (object(value).ready === true) break;
      }
      if (now() - openedAt > 180000) throw new Error('Workbench readiness timeout');
      await sleep(5);
    }
    const openReadyMs = now() - openedAt;
    const proxy = await measure(
      proxyBase,
      { name: 'wb.proxy.meta', route: 'api/meta' },
      iterations,
    );
    const direct = await launch(bin, flask.dir);
    try {
      await ready(direct.baseUrl, direct.started);
      workbench = {
        spawnReadyMs: desktop.readyLineMs,
        openReadyMs,
        open: opened.sample,
        proxy,
        direct: await measure(
          direct.baseUrl,
          { name: 'wb.direct.meta', route: 'api/meta' },
          iterations,
        ),
      };
    } finally {
      await direct.stop();
    }
  } finally {
    await desktop.stop();
  }
} finally {
  await flask.cleanup();
}
await writeFile(
  output,
  JSON.stringify({ schemaVersion: 1, environment, repos: results, workbench }) + '\n',
);
console.log(`Wrote ${output}`);
