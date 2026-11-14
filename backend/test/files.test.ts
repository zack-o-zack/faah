import { test, expect } from 'bun:test';
import { decodeFileInput } from '../src/files/decode.ts';
import { LegacyFiles } from '../src/legacy/files.ts';
import { LegacyNavigation } from '../src/legacy/navigation.ts';
import { emptyGit } from '../src/index/types.ts';
test('file request decoding preserves Go zero values, field folding, duplicate order and trailing input', () => {
  expect(decodeFileInput('{"Path":"one","path":"two","Content":"😀"} ignored', true)).toEqual({
    path: 'two',
    content: '😀',
    type: '',
  });
  expect(decodeFileInput('null', true)).toEqual({ path: '', content: '', type: '' });
  expect(() => decodeFileInput('', true)).toThrow('invalid json: EOF');
  expect(() => decodeFileInput('{', true)).toThrow('invalid json: unexpected EOF');
  expect(() => decodeFileInput('{"path":2}', true)).toThrow(
    'json: cannot unmarshal number into Go struct field fileSaveRequest.path of type string',
  );
  expect(() => decodeFileInput('[]', false)).toThrow(
    'json: cannot unmarshal array into Go value of type main.fsNewRequest',
  );
  expect(() => decodeFileInput('{path:"a"}', true)).toThrow(
    "invalid character 'p' looking for beginning of object key string",
  );
});
test('legacy file adapter fetches LSP in parallel, ports cached diff flags, and never asks Go to render', async () => {
  const seen: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      seen.push(path);
      const body =
        path === '/api/lsp/setup'
          ? { enabled: false, state: 'off', server: '' }
          : path === '/api/lsp/diagnostics'
            ? { state: 'off', server: '', diagnostics: [] }
            : path === '/api/lsp/servers'
              ? { anyRunning: false }
              : { available: true };
      return Response.json(body);
    },
  });
  const git = emptyGit();
  git.git = true;
  const nav = new LegacyNavigation({
    origin: server.url.origin,
    base: '/',
    apply: async () => {},
    rebuild: async () => {},
    touch: async () => {},
  });
  const adapter = new LegacyFiles(
    nav,
    () => git,
    () => true,
  );
  try {
    expect((await adapter.metadata(new URLSearchParams({ path: 'x.go' }))).diffAvailable).toBe(
      false,
    );
    expect(seen.sort()).toEqual(['/api/lsp/diagnostics', '/api/lsp/servers', '/api/lsp/setup']);
    seen.length = 0;
    git.statuses['x.go'] = 'M';
    expect((await adapter.metadata(new URLSearchParams({ path: 'x.go' }))).diffAvailable).toBe(
      true,
    );
    expect(seen).toEqual([]);
    git.statuses['x.go'] = 'U';
    expect((await adapter.metadata(new URLSearchParams({ path: 'x.go' }))).diffAvailable).toBe(
      false,
    );
    expect(
      (await adapter.metadata(new URLSearchParams({ path: 'x.go', ref: '123', base: '456' })))
        .diffAvailable,
    ).toBe(true);
    expect(seen).toEqual(['/api/diff']);
  } finally {
    await nav.close();
    await server.stop(true);
  }
});

test('file windows preserve Go integer saturation and signed overflow', async () => {
  const { fileWindow, goInteger } = await import('../src/files/window.ts');
  expect(fileWindow(6, '9007199254740992', '1')).toEqual({ start: 6, end: 7 });
  expect(fileWindow(6, '1', '9223372036854775807').end).toBeLessThan(0);
  expect(goInteger('9223372036854775808')).toBe(9223372036854775807n);
  expect(goInteger('9223372036854775808x')).toBe(0n);
  expect(goInteger('18446744073709551616x')).toBe(9223372036854775807n);
  expect(goInteger('-9223372036854775809')).toBe(-9223372036854775808n);
});
