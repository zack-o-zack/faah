import { bundledLanguagesInfo } from 'shiki/langs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { record, string } from '../src/decode.ts';

export async function buildGrammars(): Promise<void> {
  const dir = join(import.meta.dir, '../src/render/grammar-data');
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const languages = new Map<string, unknown>(),
    groups: Record<string, string[]> = {};
  for (const info of bundledLanguagesInfo) {
    const imported: unknown = await info.import(),
      value = record(imported).default;
    if (!Array.isArray(value)) throw new Error('invalid bundled grammar');
    groups[info.id] = [
      ...new Set(
        value.map((value) => {
          const name = string(record(value).name);
          languages.set(name, value);
          return name;
        }),
      ),
    ];
  }
  const imports: string[] = [],
    entries: string[] = [];
  for (const [i, [name, value]] of [...languages].entries()) {
    const file = encodeURIComponent(name) + '.json';
    await Bun.write(join(dir, file), JSON.stringify([value]));
    imports.push(`import g${i} from './grammar-data/${file}' with { type: 'file' };`);
    entries.push(`${JSON.stringify(name)}:g${i}`);
  }
  await Bun.write(join(dir, '../grammar-groups.json'), JSON.stringify(groups));
  await Bun.write(
    join(dir, '../grammar-assets.js'),
    imports.join('\n') +
      '\nexport const grammarAssets = {' +
      entries.join(',') +
      '};\nexport const grammarGroups = ' +
      JSON.stringify(groups) +
      ';\n',
  );
}
