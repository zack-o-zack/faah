import { prepareWatcher } from './watcher.ts';
import { buildGrammars } from './grammars.ts';
import { join } from 'node:path';
export async function buildWorkers(): Promise<void> {
  await prepareWatcher();
  await buildGrammars();
  for (const [entry, out] of [
    ['fuzzy/worker.ts', 'fuzzy/worker.bundle'],
    ['render/worker.ts', 'render/worker.bundle'],
    ['render/cache-worker.ts', 'render/cache-worker.bundle'],
  ]) {
    const result = await Bun.build({
      entrypoints: [join(import.meta.dir, '../src/' + entry)],
      target: 'bun',
    });
    if (!result.success) throw new Error(String(result.logs));
    const output = result.outputs[0];
    if (!output) throw new Error('missing Worker bundle');
    await Bun.write(join(import.meta.dir, '../src/' + out), output);
  }
}
if (import.meta.main) await buildWorkers();
