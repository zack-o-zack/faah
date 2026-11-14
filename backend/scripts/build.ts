import { join, resolve } from 'node:path';
import { mkdir, readdir } from 'node:fs/promises';
const root = resolve(import.meta.dir, '../..');
const names: string[] = ['VERSION'];
async function walk(dir: string): Promise<void> {
  for (const ent of await readdir(join(root, dir), { withFileTypes: true })) {
    const path = dir + '/' + ent.name;
    if (ent.isDirectory()) await walk(path);
    else names.push(path);
  }
}
for (const dir of ['web/dist', 'web/themes', 'web/vendor']) await walk(dir);
for (const name of await readdir(join(root, 'web')))
  if (/\.(html|svg|png|ico)$/.test(name)) names.push('web/' + name);
const lines = names.map(
  (n, i) => `import a${i} from ${JSON.stringify('../../../' + n)} with { type: "file" };`,
);
lines.push(
  'export const assets = {' + names.map((n, i) => `${JSON.stringify(n)}:a${i}`).join(',') + '};',
);
await Bun.write(join(root, 'backend/src/http/manifest.js'), lines.join('\n') + '\n');
const out = process.env.FAAH_BUILD_OUT ?? join(root, 'backend/dist');
await mkdir(out, { recursive: true });
const proc = Bun.spawn(
  [
    'bun',
    'build',
    '--compile',
    '--minify',
    join(root, 'backend/src/main.ts'),
    '--outfile',
    join(out, process.env.FAAH_BUILD_NAME ?? 'faah'),
  ],
  { stdout: 'inherit', stderr: 'inherit', cwd: out },
);
process.exit(await proc.exited);
