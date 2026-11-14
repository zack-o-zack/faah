import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { string } from '../decode.ts';
export const rendererVersion = 'shiki-3.22.0-scopes-3';
export class RenderDisk {
  private readonly db: Database;
  constructor(
    path = join(
      process.env.XDG_CACHE_HOME ?? join(homedir(), '.faah/cache'),
      'faah',
      'render.sqlite',
    ),
    readonly budget = 128 << 20,
  ) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec(
      'PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS chunks (key TEXT PRIMARY KEY, lines TEXT NOT NULL, bytes INTEGER NOT NULL, touched INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS paths (path TEXT NOT NULL, key TEXT NOT NULL, PRIMARY KEY(path,key)); CREATE INDEX IF NOT EXISTS chunks_lru ON chunks(touched);',
    );
  }
  key(source: string, lang: string, want: number): string {
    return createHash('sha256')
      .update(rendererVersion + '\0' + lang + '\0' + want + '\0')
      .update(source)
      .digest('hex');
  }
  get(key: string, path: string): string[] | undefined {
    const row = this.db
      .query<{ lines: string }, [string]>('SELECT lines FROM chunks WHERE key=?')
      .get(key);
    if (!row) return;
    try {
      const value: unknown = JSON.parse(row.lines);
      if (!Array.isArray(value)) throw new Error('invalid cached lines');
      const lines = value.map((line) => string(line));
      this.db
        .query(
          'UPDATE chunks SET touched=(SELECT COALESCE(MAX(touched),0)+1 FROM chunks) WHERE key=?',
        )
        .run(key);
      this.attach(key, path);
      return lines;
    } catch {
      this.db.query('DELETE FROM chunks WHERE key=?').run(key);
      return;
    }
  }
  private attach(key: string, path: string): void {
    if (path)
      this.db
        .query(
          'INSERT OR IGNORE INTO paths(path,key) SELECT ?,? WHERE EXISTS (SELECT 1 FROM chunks WHERE key=?)',
        )
        .run(path, key, key);
  }
  put(key: string, path: string, lines: string[]): void {
    const data = JSON.stringify(lines),
      bytes = Buffer.byteLength(data);
    if (bytes > this.budget) return;
    this.db
      .transaction(() => {
        this.db
          .query(
            'INSERT OR REPLACE INTO chunks(key,lines,bytes,touched) SELECT ?,?,?,COALESCE(MAX(touched),0)+1 FROM chunks',
          )
          .run(key, data, bytes);
        this.attach(key, path);
        this.trim();
      })
      .immediate();
  }
  trim(): void {
    let used =
      this.db
        .query<{ bytes: number }, []>('SELECT COALESCE(SUM(bytes),0) AS bytes FROM chunks')
        .get()?.bytes ?? 0;
    if (used <= this.budget) return;
    const rows = this.db
      .query<{ key: string; bytes: number }, []>(
        'SELECT key,bytes FROM chunks ORDER BY touched ASC',
      )
      .all();
    for (const row of rows) {
      if (used <= this.budget) break;
      this.db.query('DELETE FROM chunks WHERE key=?').run(row.key);
      this.db.query('DELETE FROM paths WHERE key=?').run(row.key);
      used -= row.bytes;
    }
  }
  invalidate(path: string): void {
    this.db
      .transaction(() => {
        const keys = this.db
          .query<{ key: string }, [string]>('SELECT key FROM paths WHERE path=?')
          .all(path);
        this.db.query('DELETE FROM paths WHERE path=?').run(path);
        for (const { key } of keys)
          this.db
            .query(
              'DELETE FROM chunks WHERE key=? AND NOT EXISTS (SELECT 1 FROM paths WHERE key=?)',
            )
            .run(key, key);
      })
      .immediate();
  }
  close(): void {
    this.db.close();
  }
}
