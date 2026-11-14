import { resolve, join } from 'node:path';
const out = resolve(process.env.FAAH_SPIKE_OUT ?? '/tmp/faah-bun-spike');
const result = await Bun.build({
  entrypoints: [join(import.meta.dir, 'worker.ts')],
  target: 'bun',
  outdir: out,
});
if (!result.success) throw new Error(String(result.logs));
// Compile Worker TS into its own bundled file, then embed that bundle.
await Bun.write(join(import.meta.dir, 'worker.bundle'), Bun.file(join(out, 'worker.js')));
const proc = Bun.spawn(
  ['bun', 'build', '--compile', join(import.meta.dir, 'main.ts'), '--outfile', join(out, 'spike')],
  { stdout: 'inherit', stderr: 'inherit', cwd: out },
);
process.exit(await proc.exited);
