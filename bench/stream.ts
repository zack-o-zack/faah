import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { request } from './http.ts';
import type { Fixtures } from './scenarios.ts';
import { array, now, object, stats } from './util.ts';

export async function propagation(base: string, dir: string, f: Fixtures, iterations: number) {
  const controller = new AbortController();
  const response = await fetch(new URL('api/stream', base), { signal: controller.signal });
  if (!response.ok || !response.body) throw new Error('Cannot open SSE');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let listener: ((value: unknown) => void) | undefined;
  let pendingError: Error | undefined;
  const reading = (async () => {
    let buffer = '';
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += chunk.value.replace(/\r\n/g, '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const lines = frame.split('\n');
        const event = lines
          .find((line) => line.startsWith('event:'))
          ?.slice(6)
          .trim();
        const data = lines
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (event === 'git-status') {
          const value: unknown = JSON.parse(data);
          listener?.(value);
        }
      }
    }
  })().catch((error: unknown) => {
    if (!controller.signal.aborted) pendingError = new Error(String(error));
  });
  function waitFor(dirty: boolean) {
    let timer: ReturnType<typeof setTimeout>;
    const promise = new Promise<number | undefined>((resolve) => {
      timer = setTimeout(() => {
        listener = undefined;
        resolve(undefined);
      }, 15000);
      listener = (value) => {
        const files = array(object(value).gitFiles);
        if (files.includes(f.modified) === dirty) {
          clearTimeout(timer);
          listener = undefined;
          resolve(now());
        }
      };
    });
    return promise;
  }
  const results = [];
  try {
    // Explicit refresh synchronizes the initial clean state before measuring.
    await writeFile(join(dir, f.modified), f.original);
    const initial = waitFor(false);
    await request(base, { name: 'sse.initial', route: 'api/git/refresh' });
    if (!(await initial)) throw new Error('SSE initial snapshot missing');
    for (const mode of ['save', 'external']) {
      const samples = [];
      for (let i = 0; i < iterations; i++) {
        if (pendingError) throw pendingError;
        const waiting = waitFor(true);
        const started = now();
        let responseSample;
        const content = f.original + `\n// faah propagation ${mode} ${i}\n`;
        if (mode === 'save') {
          responseSample = (
            await request(
              base,
              { name: 'save', route: 'api/file/save' },
              { path: f.modified, content },
            )
          ).sample;
        } else await writeFile(join(dir, f.modified), content);
        const observed = await waiting;
        samples.push({
          ms: (observed ?? now()) - started,
          timeout: observed === undefined,
          response: responseSample,
        });
        // Reset is outside the measured interval, and must be seen before the next mutation.
        const clean = waitFor(false);
        if (mode === 'save') {
          await request(
            base,
            { name: 'restore', route: 'api/file/save' },
            { path: f.modified, content: f.original },
          );
        } else {
          await writeFile(join(dir, f.modified), f.original);
        }
        if (!(await clean)) throw new Error('SSE clean reset timed out');
      }
      results.push({
        mode,
        latency: stats(samples.filter((s) => !s.timeout).map((s) => s.ms)),
        timeouts: samples.filter((s) => s.timeout).length,
        samples,
      });
    }
    return results;
  } finally {
    controller.abort();
    await reading;
  }
}
