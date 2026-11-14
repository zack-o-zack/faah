import { join } from 'node:path';
// Keep the native dependency literal so Bun embeds the target's Node-API
// binary. Its package's dynamic require wrapper is not compiler discoverable.
export async function prepareWatcher(): Promise<void> {
  const libc = process.platform === 'linux' ? '-' + (process.env.FAAH_WATCHER_LIBC ?? 'glibc') : '';
  const target = `${process.platform}-${process.arch}${libc}`;
  const relative = `../../node_modules/@parcel/watcher-${target}/watcher.node`;
  const exists = await Bun.file(join(import.meta.dir, '../src/watch', relative)).exists();
  const source = exists
    ? `return require(${JSON.stringify(relative)});`
    : `throw new Error(${JSON.stringify('No native watcher build for ' + target)});`;
  await Bun.write(
    join(import.meta.dir, '../src/watch/native-binding.js'),
    `export function load() { ${source} }\n`,
  );
}
