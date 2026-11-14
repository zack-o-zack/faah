import { output as report } from '../src/cli/output.ts';
import { Database } from 'bun:sqlite';
import watcher from '../node_modules/@parcel/watcher-darwin-arm64/watcher.node';
import rgAsset from '../node_modules/@vscode/ripgrep/bin/rg' with { type: 'file' };
import workerAsset from './worker.bundle' with { type: 'file' };
import { mkdirSync, mkdtempSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
const temp = mkdtempSync(join(tmpdir(), 'faah-spike-'));
try {
  const db = new Database(join(temp, 'spike.db'));
  db.exec("CREATE TABLE proof(value TEXT); INSERT INTO proof VALUES ('sqlite')");
  report('a sqlite ' + JSON.stringify(db.query('SELECT * FROM proof').get()));
  db.close();
  let done = () => {
    /* Assigned synchronously before subscribing. */
  };
  const event = new Promise<void>((resolve) => {
    done = resolve;
  });
  const callback = (error: Error | null, events: { path: string }[]) => {
    if (error) throw error;
    if (events.some((e) => e.path.endsWith('proof.txt'))) done();
  };
  await watcher.subscribe(temp, callback, {});
  await Bun.write(join(temp, 'proof.txt'), 'event');
  await Promise.race([
    event,
    new Promise((_, reject) => setTimeout(() => reject(new Error('watcher timeout')), 5000)),
  ]);
  await watcher.unsubscribe(temp, callback, {});
  report('b watcher event');
  const worker = new Worker(workerAsset);
  const html = await new Promise<unknown>((resolve, reject) => {
    worker.onmessage = (e) => resolve(e.data);
    worker.onerror = reject;
  });
  worker.terminate();
  if (typeof html !== 'string' || !html.includes('answer')) throw new Error('highlight failed');
  report('c Shiki grammar/theme ' + html.length);
  report('e Worker');
  const cache = join(
    process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'),
    'faah',
    'spike',
    'ripgrep-1.17.0',
  );
  mkdirSync(cache, { recursive: true });
  const rg = join(cache, 'rg');
  await Bun.write(rg, Bun.file(rgAsset));
  chmodSync(rg, 0o755);
  const rgProcess = Bun.spawn([rg, '--json', 'event', join(temp, 'proof.txt')], { stdout: 'pipe' });
  const output = await new Response(rgProcess.stdout).text();
  if ((await rgProcess.exited) !== 0 || !output.includes('"type":"match"'))
    throw new Error('rg failed');
  report('d rg JSON ' + output.length);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
