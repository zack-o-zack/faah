import { test, expect, vi } from 'vitest';
import { api, apiPost, apiPostJson } from './api.ts';
test('requests preserve base paths, query filtering and JSON error detail', async () => {
  const base = document.createElement('base');
  base.href = 'http://localhost/review/';
  document.head.append(base);
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => Response.json({ ok: true }));
  try {
    await api('/api/tree', { dir: 'web', empty: '', absent: undefined });
    expect(String(fetch.mock.calls[0]?.[0])).toBe('http://localhost/review/api/tree?dir=web');
    await apiPost('api/close', { path: 'file.js' });
    expect(fetch.mock.calls[1]?.[1]?.body).toBeUndefined();
    await apiPostJson('api/save', { value: 'hello' });
    expect(fetch.mock.calls[2]?.[1]?.body).toBe('{"value":"hello"}');
    fetch.mockResolvedValue(Response.json({ error: 'failed', detail: 42 }));
    await expect(api('api/fail')).rejects.toMatchObject({
      message: 'failed',
      body: { detail: 42 },
    });
  } finally {
    base.remove();
  }
});
