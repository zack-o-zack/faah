import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
export function stateDir(): string {
  return process.env.XDG_STATE_HOME
    ? join(process.env.XDG_STATE_HOME, 'faah')
    : join(homedir(), '.faah');
}
export function openDB(path = join(stateDir(), 'faah.db')): Database {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path, { create: true, strict: true });
  db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  db.transaction(() => {
    const version =
      db.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version ?? 0;
    if (version > 1) throw new Error('database schema is newer than this backend');
    if (version < 1)
      db.exec(
        'CREATE TABLE workbench_items (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE workbench_clones (repo TEXT PRIMARY KEY, path TEXT NOT NULL); PRAGMA user_version=1;',
      );
  }).immediate();
  return db;
}
