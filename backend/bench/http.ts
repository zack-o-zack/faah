import { cpus, release, platform } from 'node:os';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cache, corpus } from '../../bench/corpus.ts';
import { launch, flags } from '../../bench/launch.ts';
import { measure, ready, type Sample } from '../../bench/http.ts';
import { fixtures, scenarios } from '../../bench/scenarios.ts';
import { responsiveness } from '../../bench/load.ts';
import { cloneWorkspace, stats, now, command } from '../../bench/util.ts';

const args = process.argv.slice(2);
const rawOnly = args.includes('--raw-only');
function option(name: string) {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
}
const path = option('--bin'),
  out = option('--out'),
  label = option('--label');
if (!path || !out || !label)
  throw new Error(
    'Usage: bun backend/bench/http.ts --bin PATH --label NAME --repos flask,kubernetes --out /tmp/RESULT.json',
  );
const binary = resolve(path),
  repos = [];
const environment = {
  cpu: cpus()[0]?.model ?? '',
  os: platform() + ' ' + release(),
  bun: Bun.version,
  go: await command(['go', 'version']),
  sourceCommit: await command(['git', 'rev-parse', 'HEAD']),
  sourceDirty: Boolean(await command(['git', 'status', '--porcelain'])),
  binaryBytes: (await stat(binary)).size,
  flags,
};
for (const repo of (await corpus()).filter(
  (r) => !option('--repos') || option('--repos')?.split(',').includes(r.name),
)) {
  const startup = [];
  for (let i = 0; i < (rawOnly ? 0 : 5); i++) {
    const workspace = await cloneWorkspace(join(cache, repo.name));
    try {
      const server = await launch(binary, workspace.dir);
      try {
        startup.push(await ready(server.baseUrl, server.started));
      } finally {
        await server.stop();
      }
    } finally {
      await workspace.cleanup();
    }
  }
  const workspace = await cloneWorkspace(join(cache, repo.name));
  try {
    const fixture = await fixtures(workspace.dir);
    const server = await launch(binary, workspace.dir);
    try {
      await ready(server.baseUrl, server.started);
      const latency = [];
      const owned = scenarios(fixture).filter(
        (s) =>
          ['meta', 'tree.root', 'tree.deep', 'outline', 'def'].includes(s.name) ||
          s.name.startsWith('find.') ||
          s.name.startsWith('search.'),
      );
      for (const spec of rawOnly ? [] : owned) {
        process.stdout.write(repo.name + ': ' + spec.name + '\n');
        latency.push(await measure(server.baseUrl, spec, 30));
      }
      const expected = await readFile(join(workspace.dir, fixture.typical));
      const rawSamples: Sample[] = [];
      const url = new URL('api/raw', server.baseUrl);
      url.searchParams.set('path', fixture.typical);
      for (let i = 0; i < 35; i++) {
        const start = now();
        const response = await fetch(url, {
          signal: AbortSignal.timeout(180000),
          headers: { 'Accept-Encoding': 'identity' },
        });
        const bytes = await response.arrayBuffer();
        const ms = now() - start;
        if (!response.ok || !expected.equals(Buffer.from(bytes)))
          throw new Error('raw response mismatch');
        if (i >= 5)
          rawSamples.push({
            ms,
            status: response.status,
            bytes: bytes.byteLength,
            count: bytes.byteLength,
            counts: { count: bytes.byteLength },
          });
      }
      latency.push({
        name: 'raw',
        route: 'api/raw',
        params: { path: fixture.typical },
        latency: stats(rawSamples.map((s) => s.ms)),
        samples: rawSamples,
      });
      const heavy = owned.find((s) => s.name === 'search.regex');
      if (!heavy) throw new Error('missing search workload');
      if (!rawOnly) process.stdout.write(repo.name + ': responsiveness\n');
      const underLoad = rawOnly ? undefined : await responsiveness(server.baseUrl, heavy, 10);
      if (underLoad && (underLoad.meta.errorCount || underLoad.search.errorCount))
        throw new Error('responsiveness errors');
      repos.push({
        name: repo.name,
        sha: repo.sha,
        fixture: { ...fixture, original: undefined },
        startup: rawOnly
          ? undefined
          : { samples: startup, ready: stats(startup.map((s) => s.readyMs)) },
        latency,
        responsiveness: underLoad,
      });
    } finally {
      await server.stop();
    }
  } finally {
    await workspace.cleanup();
  }
  await Bun.write(out + '.partial', JSON.stringify({ binary, label, environment, repos }, null, 2));
}
await Bun.write(
  out,
  JSON.stringify(
    {
      binary,
      label,
      environment,
      timestamp: new Date().toISOString(),
      iterations: 30,
      warmups: 5,
      startupLaunches: rawOnly ? 0 : 5,
      rawOnly,
      repos,
    },
    null,
    2,
  ) + '\n',
);
