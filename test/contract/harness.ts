import { beforeAll, afterAll, test, expect } from 'bun:test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fixture, type Fixture } from './fixtures.ts';
import { launch, type Server } from './launch.ts';
import { normalize } from './normalize.ts';
import { request, type Options } from './transport.ts';

export interface Context {
  f: Fixture;
  server: Server;
}
export async function golden(area: string, name: string, value: unknown): Promise<void> {
  const path = join(import.meta.dirname, 'golden', area, `${name}.json`);
  if (process.env.FAAH_CONTRACT_RECORD === '1') {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(value, null, 2) + '\n');
  } else {
    const expected: unknown = JSON.parse(await readFile(path, 'utf8'));
    expect(value).toEqual(expected);
  }
}
export async function capture(
  c: Context,
  area: string,
  name: string,
  route: string,
  options: Options = {},
  workspaceId?: string,
) {
  const response = await request(c.server.baseUrl, route, {
    ...options,
    stableFile: route.startsWith('api/file?'),
  });
  await golden(
    area,
    name,
    normalize(response, route, { fixture: c.f, baseUrl: c.server.baseUrl, workspaceId }),
  );
  return response;
}
export function suite(area: string, basePath = '/') {
  let context: Context | undefined;
  beforeAll(async () => {
    const f = await fixture();
    try {
      context = { f, server: await launch(f, basePath) };
    } catch (error) {
      await f.cleanup();
      throw error;
    }
  }, 60000);
  afterAll(async () => {
    if (context) {
      try {
        await context.server.stop();
      } finally {
        await context.f.cleanup();
      }
    }
  }, 15000);
  const get = () => {
    if (!context) throw new Error('Suite not initialized');
    return context;
  };
  return {
    case(name: string, route: string | ((f: Fixture) => string), options: Options = {}) {
      test(`${area}/${name}`, async () => {
        const c = get();
        await capture(c, area, name, typeof route === 'string' ? route : route(c.f), options);
      }, 30000);
    },
    run(name: string, fn: (c: Context) => Promise<void>) {
      test(`${area}/${name}`, () => fn(get()), 30000);
    },
  };
}
export function mutation(area: string, name: string, fn: (c: Context) => Promise<void>) {
  test(`${area}/${name}`, async () => {
    const f = await fixture();
    let server: Server | undefined;
    let c: Context | undefined;
    try {
      server = await launch(f);
      c = { f, server };
      await fn(c);
    } finally {
      try {
        if (c) await c.server.stop();
        else if (server) await server.stop();
      } finally {
        await f.cleanup();
      }
    }
  }, 60000);
}
