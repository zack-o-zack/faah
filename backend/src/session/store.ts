import { createHash } from 'node:crypto';
import { normalize } from 'node:path';
import type { Database } from 'bun:sqlite';
import { parse, record, string, number } from '../decode.ts';
import type { WorkspaceSession } from './model.ts';
import { GoNumber, GoObject, parseGoJSON } from '../compat/go-json.ts';
import { sessionJSON } from './json.ts';

// Preserve Go's base-path key, or the first eight SHA-256 bytes of the cleaned root.
export function sessionKey(base: string, root: string): string {
  if (base && base !== '/') return base.replace(/^\/+|\/+$/g, '').replaceAll('/', '_');
  return createHash('sha256').update(normalize(root)).digest('hex').slice(0, 16);
}

function decodeSession(text: string): WorkspaceSession {
  const fields = parse(text);
  const ordered = parseGoJSON(text, true);
  const active =
    ordered instanceof GoObject
      ? ordered.entries.find(([key]) => key === 'active')?.[1]
      : undefined;
  if (!(active instanceof GoNumber)) throw new Error('invalid stored active tab');
  if (!Array.isArray(fields.tabs) || !Array.isArray(fields.openDirs))
    throw new Error('invalid stored session');
  const session: WorkspaceSession = {
    tabs: fields.tabs.map((value) => {
      const tab = record(value);
      const ref = tab.ref === undefined ? '' : string(tab.ref);
      return { path: string(tab.path), ...(ref ? { ref } : {}) };
    }),
    active: Number.isSafeInteger(Number(active.source))
      ? Number(active.source)
      : BigInt(active.source),
    openDirs: fields.openDirs.map((value) => string(value)),
  };
  if (Array.isArray(fields.drafts) && fields.drafts.length) {
    session.drafts = fields.drafts.map((value) => {
      const draft = record(value);
      return {
        id: number(draft.id),
        path: string(draft.path),
        line: number(draft.line),
        side: string(draft.side),
        body: string(draft.body),
      };
    });
  }
  return session;
}

/** SQLite session storage shared by workspace processes; mutations read under an immediate lock. */
export class SessionStore {
  constructor(private readonly db: Database) {}

  get(key: string): WorkspaceSession {
    const row = this.db
      .query<{ data: string }, [string]>('SELECT data FROM workspace_sessions WHERE key=?')
      .get(key);
    if (row) {
      try {
        return decodeSession(row.data);
      } catch {
        /* Go ignores unreadable session data. */
      }
    }
    return { tabs: [], active: 0, openDirs: [] };
  }

  update(key: string, change: (session: WorkspaceSession) => void): WorkspaceSession {
    return this.db
      .transaction(() => {
        const session = this.get(key);
        change(session);
        if (!session.drafts?.length) delete session.drafts;
        this.db
          .query('INSERT OR REPLACE INTO workspace_sessions(key,data) VALUES (?,?)')
          .run(key, sessionJSON(session));
        return session;
      })
      .immediate();
  }
}
