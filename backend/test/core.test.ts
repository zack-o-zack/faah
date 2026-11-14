import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flags } from '../src/cli/flags.ts';
import { basePath, safePath } from '../src/http/paths.ts';
import { localPost, trustedGet } from '../src/http/guards.ts';
import { staticCandidates } from '../src/http/static-path.ts';
import { Settings } from '../src/settings/service.ts';
import { openDB } from '../src/store/db.ts';
import { WorkbenchStore, dirItem, itemID } from '../src/workbench/store.ts';
import { proxy } from '../src/http/proxy.ts';
test('Go flag parsing stops at first target and supports bool equals', () => {
  const f = flags(['--port=0', '-no-open=false', '--no-lsp', 'target', '-quiet']);
  expect(f.port).toBe(0);
  expect(f.bool.has('no-open')).toBe(false);
  expect(f.bool.has('no-lsp')).toBe(true);
  expect(f.targets).toEqual(['target', '-quiet']);
  expect(() => flags(['-desktop-host', '.'])).toThrow();
  expect(() => flags(['-port', 'bad'])).toThrow();
});
test('base paths and lexical containment', () => {
  expect(basePath(' a/../b ')).toBe('/b/');
  expect(basePath('.')).toBe('/');
  expect(safePath('/root', '../bad')).toBeUndefined();
  expect(safePath('/root', 'a/../b')).toBe('/root/b');
});
test('guards preserve numeric Host and scheme oddities', () => {
  expect(trustedGet('example.com:80')?.status).toBe(403);
  expect(trustedGet('192.0.2.1:80')).toBeUndefined();
  expect(localPost('GET', 'localhost', '')).toEqual({ status: 405, error: 'POST only' });
  expect(localPost('POST', '127.0.0.1:80', 'https://127.0.0.1:80')).toBeUndefined();
  expect(localPost('POST', 'localhost', '')?.status).toBe(403);
});
test('static priority and traversal', () => {
  expect(staticCandidates('app.js')).toEqual(['web/dist/app.js', 'web/app.js.gz', 'web/app.js']);
  expect(staticCandidates('../secret')).toEqual([]);
});
test('settings preserve unknown keys, synchronize bridges and save raw atomically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'faah-settings-'));
  try {
    const s = new Settings(join(dir, 'settings.json'));
    s.update({ agent: 'codex', unknown: 42 });
    expect(s.merged()['agent.harness']).toBe('codex');
    s.update({ agent: null });
    expect(s.raw().unknown).toBe(42);
    expect(s.raw()['agent.harness']).toBeUndefined();
    s.saveRaw('{"workbench.colorTheme":"dark"}');
    expect(s.merged()['workbench.colorTheme']).toBe('dark');
    expect(readFileSync(s.path, 'utf8')).toBe('{\n  "workbench.colorTheme": "dark"\n}\n');
    expect(() => s.saveRaw('[]')).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('SQLite migration, stable IDs, pins and two-process writes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'faah-db-'));
  const path = join(dir, 'faah.db');
  const db = openDB(path);
  try {
    const store = new WorkbenchStore(db);
    const it = dirItem('/repo');
    expect(itemID('dir', '/repo')).toHaveLength(12);
    store.record(it);
    store.pin(it.id, true);
    store.record(it);
    expect(store.get(it.id)?.pinned).toBe(true);
    const worker = join(import.meta.dir, 'write-db.ts');
    const procs = [0, 1].map((n) =>
      Bun.spawn([process.execPath, worker, path, String(n)], { stdout: 'pipe', stderr: 'pipe' }),
    );
    expect(await Promise.all(procs.map((p) => p.exited))).toEqual([0, 0]);
    expect(store.items()).toHaveLength(3);
    expect(db.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version).toBe(
      1,
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('proxy forwards Host and flushes first SSE frame before stream ends', async () => {
  let received = '';
  const upstream = Bun.serve({
    port: 0,
    fetch(req) {
      received = req.headers.get('host') ?? '';
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('event: ready\ndata: {}\n\n'));
          },
          cancel() {},
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    },
  });
  const abort = new AbortController();
  try {
    const response = await proxy(
      new Request('http://localhost:7777/api/stream', { signal: abort.signal }),
      upstream.url.origin,
    );
    const reader = response.body?.getReader();
    expect(new TextDecoder().decode((await reader?.read())?.value)).toContain('event: ready');
    expect(received).toBe('localhost:7777');
    await reader?.cancel();
  } finally {
    abort.abort();
    await upstream.stop(true);
  }
});
