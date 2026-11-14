import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDB } from '../src/store/db.ts';
import { sessionJSON } from '../src/session/json.ts';
import { Session } from '../src/session/service.ts';
import { SessionStore, sessionKey } from '../src/session/store.ts';
import { decodeSessionUpdate } from '../src/session/compat.ts';

function input(text: string) {
  return decodeSessionUpdate(Buffer.from(text));
}

test('schema upgrade retains workbench data and session updates preserve drafts across connections', () => {
  const directory = mkdtempSync(join(tmpdir(), 'faah-session-'));
  const path = join(directory, 'state.sqlite');
  const old = new Database(path);
  old.run(
    "CREATE TABLE workbench_items (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE workbench_clones (repo TEXT PRIMARY KEY, path TEXT NOT NULL); INSERT INTO workbench_items VALUES ('kept','{}'); PRAGMA user_version=1;",
  );
  old.close();
  const first = openDB(path);
  const second = openDB(path);
  try {
    const key = sessionKey('/w/abc/', '/temporary/checkout');
    const session = new Session({ store: new SessionStore(first), key });
    const other = new Session({ store: new SessionStore(second), key });
    expect(first.query('SELECT id FROM workbench_items').all()).toEqual([{ id: 'kept' }]);
    expect(session.get()).toEqual({ tabs: [], active: 0, openDirs: [] });
    const drafts = [{ id: 1, path: 'src/file.ts', line: 3, side: 'RIGHT', body: 'Review this' }];
    session.drafts(drafts);
    other.update({ tabs: [{ path: 'file' }], active: 1 });
    session.update({ openDirs: ['src'] });
    expect(other.get()).toEqual({ tabs: [{ path: 'file' }], active: 1, openDirs: ['src'], drafts });
    expect(new SessionStore(first).get('another')).toEqual({ tabs: [], active: 0, openDirs: [] });
    session.drafts([]);
    expect(other.get().drafts).toBeUndefined();
  } finally {
    second.close();
    first.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('session input follows ordered Go struct decoding without exposing drafts', () => {
  expect(
    input(
      '{"tabs":[null,{"path":"x","ref":"old","REF":""}],"active":2,"ACTIVE":null,"drafts":[]} trailing',
    ),
  ).toEqual({ tabs: [{ path: '' }, { path: 'x' }] });
  expect(input('null')).toEqual({});
  expect(input('{"openDirs":[null,"src"]}')).toEqual({ openDirs: ['', 'src'] });
  expect(() => input('{')).toThrow('invalid JSON: unexpected EOF');
});

test('session identities follow the stable base path instead of a temporary checkout', () => {
  expect(sessionKey('/w/abc/', '/one')).toBe(sessionKey('/w/abc/', '/two'));
  expect(sessionKey('/', '/one')).not.toBe(sessionKey('/', '/two'));
  expect(sessionKey('/', '/one/../two')).toBe(sessionKey('/', '/two'));
});

test('session active indexes preserve signed 64-bit digits across SQLite and HTTP encoding', () => {
  const db = openDB(':memory:');
  try {
    const session = new Session({ store: new SessionStore(db), key: 'large' });
    for (const active of ['9223372036854775807', '-9223372036854775808']) {
      session.update(input('{"active":' + active + '}'));
      expect(session.get().active).toBe(BigInt(active));
      expect(sessionJSON(session.get())).toContain('"active":' + active);
    }
    expect(() => input('{"active":1.0}')).toThrow('cannot unmarshal number 1.0');
    expect(() => input('{"active":9223372036854775808}')).toThrow('of type int');
  } finally {
    db.close();
  }
});
