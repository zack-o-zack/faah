import { createHash } from 'node:crypto';
import { basename, normalize } from 'node:path';
import { type Database } from 'bun:sqlite';
import { parse, string, number } from '../decode.ts';
export interface Item {
  id: string;
  kind: string;
  path?: string;
  url?: string;
  title?: string;
  repo?: string;
  number?: number;
  pinned?: boolean;
  lastOpened: number;
}
export function itemID(kind: string, key: string): string {
  return createHash('sha256')
    .update(kind + '\0' + key)
    .digest('hex')
    .slice(0, 12);
}
export function dirItem(path: string): Item {
  path = normalize(path);
  return { id: itemID('dir', path), kind: 'dir', path, title: basename(path), lastOpened: 0 };
}
function decode(text: string): Item {
  const v = parse(text);
  const result: Item = { id: string(v.id), kind: string(v.kind), lastOpened: number(v.lastOpened) };
  for (const key of ['path', 'url', 'title', 'repo'] as const)
    if (v[key] !== undefined) result[key] = string(v[key]);
  if (v.number !== undefined) result.number = number(v.number);
  if (v.pinned === true) result.pinned = true;
  return result;
}
export class WorkbenchStore {
  constructor(readonly db: Database) {}
  items(): Item[] {
    return this.db
      .query<{ data: string }, []>('SELECT data FROM workbench_items')
      .all()
      .map((r) => decode(r.data))
      .sort((a, b) => b.lastOpened - a.lastOpened);
  }
  get(id: string): Item | undefined {
    const row = this.db
      .query<{ data: string }, [string]>('SELECT data FROM workbench_items WHERE id=?')
      .get(id);
    return row ? decode(row.data) : undefined;
  }
  record(item: Item): void {
    this.db
      .transaction(() => {
        const old = this.get(item.id);
        this.put({
          ...item,
          ...(old?.pinned ? { pinned: true } : {}),
          title: item.title || old?.title,
          lastOpened: Date.now(),
        });
        for (const row of this.items()
          .filter((i) => !i.pinned)
          .slice(50))
          this.remove(row.id);
      })
      .immediate();
  }
  put(item: Item): void {
    this.db
      .query('INSERT OR REPLACE INTO workbench_items VALUES (?,?)')
      .run(item.id, JSON.stringify(item));
  }
  remove(id: string): void {
    this.db.query('DELETE FROM workbench_items WHERE id=?').run(id);
  }
  pin(id: string, pinned: boolean): void {
    this.db
      .transaction(() => {
        const it = this.get(id);
        if (it) {
          if (pinned) it.pinned = true;
          else delete it.pinned;
          this.put(it);
        }
      })
      .immediate();
  }
  clone(repo: string): string {
    return (
      this.db
        .query<{ path: string }, [string]>('SELECT path FROM workbench_clones WHERE repo=?')
        .get(repo.toLowerCase())?.path ?? ''
    );
  }
  rememberClone(repo: string, path: string): void {
    this.db
      .query('INSERT OR REPLACE INTO workbench_clones VALUES (?,?)')
      .run(repo.toLowerCase(), path);
  }
}
