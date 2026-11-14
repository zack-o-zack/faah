import { join } from 'node:path';
import { homedir } from 'node:os';
import { walk } from '../src/index/walk.ts';
import { Search } from '../src/search/service.ts';
import { defaultIgnores } from '../src/ignore/service.ts';
import { rgPath } from '../src/search/rg.ts';
import { fixture } from '../../test/contract/fixtures.ts';
const roots = process.argv.includes('--fixture-only')
  ? []
  : ['flask', 'redis', 'react', 'kubernetes'].map((name) => ({
      name,
      root: join(homedir(), '.cache/faah-bench/repos', name),
    }));
const f = await fixture();
const capped = await fixture();
for (let i = 0; i < 200; i++)
  await capped.write(`file-cap/${String(i).padStart(3, '0')}.txt`, 'filecapneedle\n');
roots.unshift({ name: 'contract-file-cap', root: capped.root });
roots.unshift({ name: 'contract', root: f.root });
const output = [];
try {
  for (const { name, root } of roots) {
    const start = performance.now();
    const index = await walk({
      root,
      publish: () => {
        /* Benchmark only the completed flat file set. */
      },
    });
    const walkMs = performance.now() - start;
    const args = [
      '--files',
      '--hidden',
      '--no-ignore-global',
      '--no-ignore-parent',
      '--no-config',
      '-0',
    ];
    for (const pattern of defaultIgnores) {
      const p = pattern.endsWith('/') ? '**/' + pattern + '**' : pattern;
      args.push('-g', '!' + p);
    }
    const rg = Bun.spawn([await rgPath(), ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
    const list = (await new Response(rg.stdout).text()).split('\0').filter(Boolean);
    const errors = await new Response(rg.stderr).text();
    if ((await rg.exited) > 1) throw new Error(errors);
    const ours = new Set(index.files.map((f) => f.path)),
      theirs = new Set(list);
    const missing = [...ours].filter((p) => !theirs.has(p)),
      extra = list.filter((p) => !ours.has(p));
    const parity = {
      name,
      walkerFiles: ours.size,
      rgFiles: theirs.size,
      missing: missing.length,
      extra: extra.length,
      missingExamples: missing.slice(0, 8),
      extraExamples: extra.slice(0, 8),
      walkMs,
    };
    const timings: Record<string, Record<string, number[]>> = {};
    const counts: Record<string, Record<string, number[]>> = {};
    if (name === 'kubernetes') {
      const queries = [
        { name: 'common', query: 'return' },
        { name: 'rare', query: 'NewDefaultComponentConfig' },
        { name: 'regex', query: '(function|return|class)\\s+\\w+', regex: true },
        { name: 'case-word', query: 'return', case: true, word: true },
        { name: 'no-hit', query: 'zzFAAH_NO_MATCH_9c71zz' },
      ];
      const strategies = ['explicit', 'walk'] as const;
      const searches = new Map(
        strategies.map((strategy) => [
          strategy,
          new Search({
            root,
            files: () => index.files,
            strategy,
            excluded: () =>
              [...index.children.values()].flatMap((kids) => kids.filter((n) => n.ignored)),
          }),
        ]),
      );
      for (const strategy of strategies) {
        timings[strategy] = {};
        counts[strategy] = {};
      }
      for (const query of queries) {
        for (const strategy of strategies) {
          const search = searches.get(strategy);
          if (!search) throw new Error('missing strategy');
          for (let i = 0; i < 2; i++) await search.search(query, AbortSignal.timeout(180000));
          const byQuery = timings[strategy],
            byCount = counts[strategy];
          if (!byQuery || !byCount) throw new Error('missing results');
          byQuery[query.name] = [];
          byCount[query.name] = [];
        }
        // Alternate the order to reduce warm-cache and concurrent machine effects.
        for (let i = 0; i < 5; i++) {
          for (const strategy of i % 2 ? [...strategies].reverse() : strategies) {
            const search = searches.get(strategy);
            if (!search) throw new Error('missing strategy');
            const start = performance.now();
            const result = await search.search(query, AbortSignal.timeout(180000));
            timings[strategy]?.[query.name]?.push(performance.now() - start);
            counts[strategy]?.[query.name]?.push(
              result.results.reduce((n, f) => n + f.matches.length, 0),
            );
          }
        }
      }
    }
    const result = { ...parity, timings, counts };
    output.push(result);
    process.stdout.write(JSON.stringify(result) + '\n');
  }
} finally {
  await f.cleanup();
  await capped.cleanup();
}
await Bun.write(
  process.env.FAAH_RG_REPORT ?? '/tmp/faah-phase2-rg-strategies.json',
  JSON.stringify(output, null, 2),
);
