import { prepareWatcher } from './watcher.ts';
import { buildGrammars } from './grammars.ts';
import { join } from 'node:path';

export async function buildWorkers(): Promise<void> {
  await prepareWatcher();
  await buildGrammars();
  const workers: readonly (readonly [entry: string, bundle: string])[] = [
    ['fuzzy/worker.ts', 'fuzzy/worker.bundle'],
    ['render/worker.ts', 'render/worker.bundle'],
    ['render/cache-worker.ts', 'render/cache-worker.bundle'],
  ];
  for (const [entry, out] of workers) {
    const result = await Bun.build({
      entrypoints: [join(import.meta.dir, '../src', entry)],
      target: 'bun',
    });
    if (!result.success) throw new Error(result.logs.map((log) => log.message).join('\n'));
    const output = result.outputs[0];
    if (!output) throw new Error('missing Worker bundle');
    await Bun.write(join(import.meta.dir, '../src', out), output);
  }
}
if (import.meta.main) await buildWorkers();
