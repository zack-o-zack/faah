import { createRoot } from 'solid-js';
import { expect, test } from 'vitest';
import { createResourceRequest } from './resource-request.js';

test('superseded and disposed resource requests reject transports that ignore abort', async () => {
  let finish, request, dispose;
  createRoot((release) => {
    dispose = release;
    request = createResourceRequest(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  });
  const old = request('old');
  const oldFinish = finish;
  const current = request('current');
  oldFinish({ stale: true });
  await expect(old).rejects.toMatchObject({ name: 'AbortError' });
  dispose();
  finish({ stale: true });
  await expect(current).rejects.toMatchObject({ name: 'AbortError' });
});
