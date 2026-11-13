import { mutation, capture, golden } from './harness.ts';
import { normalize } from './normalize.ts';
import { object } from './transport.ts';
import { expect } from 'bun:test';

for (const route of ['api/stream', 'api/git/stream'])
  for (const method of ['GET', 'POST'])
    mutation('stream', `${route.replaceAll('/', '-')}-${method.toLowerCase()}`, async (c) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const res = await fetch(new URL(route, c.server.baseUrl), {
          method,
          signal: controller.signal,
          headers: { 'Accept-Encoding': 'gzip' },
        });
        if (!res.body) throw new Error('SSE response has no body');
        reader = res.body.getReader();
        let pending = '';
        const decoder = new TextDecoder();
        async function frame(): Promise<{ event: string; data: unknown }> {
          while (true) {
            const boundary = pending.indexOf('\n\n');
            if (boundary >= 0) {
              const text = pending.slice(0, boundary);
              pending = pending.slice(boundary + 2);
              if (text.startsWith(':')) continue;
              const lines = text.split('\n');
              const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
              const data = lines
                .filter((line) => line.startsWith('data: '))
                .map((line) => line.slice(6))
                .join('\n');
              if (!event || !data) throw new Error(`Invalid SSE frame: ${text}`);
              const parsed: unknown = JSON.parse(data);
              return { event, data: parsed };
            }
            if (!reader) throw new Error('Missing reader');
            const next = await reader.read();
            if (next.done) throw new Error('SSE ended before expected event');
            pending += decoder.decode(next.value, { stream: true });
          }
        }
        const headers = Object.fromEntries(
          [
            'content-type',
            'cache-control',
            'connection',
            'x-accel-buffering',
            'content-encoding',
          ].map((key) => [key, res.headers.get(key)]),
        );
        const initial = [];
        if (route === 'api/stream') {
          const metrics = await frame();
          expect(metrics.event).toBe('metrics');
          initial.push({
            ...metrics,
            data: normalize(metrics.data, 'metrics', { fixture: c.f, baseUrl: c.server.baseUrl }),
          });
        }
        const git = await frame();
        expect(git.event).toBe('git-status');
        initial.push({
          ...git,
          data: normalize(git.data, 'api/git/refresh', { fixture: c.f, baseUrl: c.server.baseUrl }),
        });
        const name = `${route.replaceAll('/', '-')}-${method.toLowerCase()}`;
        await golden('stream', `${name}-initial`, { status: res.status, headers, frames: initial });
        await capture(c, 'stream', `${name}-save`, 'api/file/save', {
          method: 'POST',
          json: { path: 'stream-new.txt', content: 'stream saved\n' },
        });
        // The save triggers GitWatcher. Ignore unrelated periodic metrics, retain the next Git event.
        let changed = await frame();
        while (changed.event === 'metrics') changed = await frame();
        expect(changed.event).toBe('git-status');
        if (!object(changed.data) || !object(changed.data.statuses))
          throw new Error('Invalid Git status payload');
        expect(changed.data.statuses['stream-new.txt']).toBe('U');
        await golden(
          'stream',
          `${name}-changed`,
          normalize(changed, 'api/git/refresh', { fixture: c.f, baseUrl: c.server.baseUrl }),
        );
      } finally {
        clearTimeout(timeout);
        controller.abort();
        if (reader) await reader.cancel().catch(() => {});
      }
    });
