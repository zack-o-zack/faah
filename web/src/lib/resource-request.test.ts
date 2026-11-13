import { createRoot } from 'solid-js';
import { expect, test } from 'vitest';
import { createResourceRequest } from './resource-request.ts';

test('superseded and disposed resource requests reject transports that ignore abort', async () => {
  let finish: ((value: unknown) => void) | undefined;
  const { request, dispose } = createRoot((dispose) => ({
    dispose,
    request: createResourceRequest(
      () =>
        new Promise<unknown>((resolve) => {
          finish = resolve;
        }),
    ),
  }));
  const old = request('old');
  const oldFinish = finish;
  const current = request('current');
  if (!oldFinish || !finish) throw new Error('Request did not start');
  oldFinish({ stale: true });
  await expect(old).rejects.toMatchObject({ name: 'AbortError' });
  dispose();
  finish({ stale: true });
  await expect(current).rejects.toMatchObject({ name: 'AbortError' });
});
