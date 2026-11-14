import { join } from 'node:path';
export async function buildWorkers(): Promise<void> {
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, '../src/fuzzy/worker.ts')],
    target: 'bun',
  });
  if (!result.success) throw new Error(String(result.logs));
  const output = result.outputs[0];
  if (!output) throw new Error('missing Worker bundle');
  await Bun.write(join(import.meta.dir, '../src/fuzzy/worker.bundle'), output);
}
if (import.meta.main) await buildWorkers();
