import { atoi } from '../compat/go-numbers.ts';
import { trimSpace } from '../compat/go-strings.ts';
import { ServiceError } from '../errors.ts';
import { decodeStringFields } from '../files/decode.ts';
import { readCapped } from '../http/body.ts';
import { localPost } from '../http/guards.ts';
import { fail, json } from '../http/response.ts';
import type { RouteDef } from '../http/routes.ts';
import type { GitActions } from './actions.ts';
import type { GitReads } from './reads.ts';

/** Decode required string fields; any decoding problem reports Go's fixed message. */
async function fields(
  request: Request,
  cap: number,
  names: string[],
  required: string,
): Promise<Record<string, string>> {
  try {
    const body = decodeStringFields(await readCapped(request, cap), names);
    if (names.some((name) => !body[name])) throw new Error('missing field');
    return body;
  } catch {
    throw new ServiceError('invalid', required);
  }
}

export function gitReadRoutes(reads: GitReads): RouteDef[] {
  const getOnly = ['GET'];
  return [
    {
      path: 'api/diff',
      fallbackStatus: 400,
      handle: async ({ query }) =>
        json(
          await reads.fileDiff({
            path: query.get('path') ?? '',
            ref: query.get('ref') ?? '',
            base: query.get('base') ?? '',
          }),
        ),
    },
    {
      path: 'api/gutter',
      fallbackStatus: 400,
      handle: async ({ query }) =>
        json(await reads.gutter(query.get('path') ?? '', query.get('ref') ?? '')),
    },
    {
      path: 'api/git/log',
      methods: getOnly,
      fallbackStatus: 400,
      async handle({ query }) {
        const limit = atoi(query.get('limit') ?? '') ?? 0;
        return json(await reads.log(limit > 0 && limit <= 50 ? limit : 5));
      },
    },
    {
      path: 'api/unpushed',
      methods: getOnly,
      fallbackStatus: 400,
      handle: async ({ query }) => json(await reads.unpushed(atoi(query.get('limit') ?? '') ?? 0)),
    },
    {
      path: 'api/commitfiles',
      methods: getOnly,
      fallbackStatus: 400,
      handle: async ({ query }) => json(await reads.files(query.get('sha') ?? '')),
    },
    {
      path: 'api/commitdetail',
      methods: getOnly,
      fallbackStatus: 400,
      async handle({ query }) {
        const detail = await reads.detail(query.get('sha') ?? '');
        return detail ? json(detail) : fail(404, 'unknown commit');
      },
    },
  ];
}

/** Mutations: same-origin POSTs only (Go's localPost), mapped to 502 when Git fails. */
function mutationRoute(path: string, handle: (request: Request) => Promise<Response>): RouteDef {
  return {
    path,
    fallbackStatus: 502,
    handle: ({ request }) => localPost(request) ?? handle(request),
  };
}

export function gitActionRoutes(actions: GitActions): RouteDef[] {
  const stage = (unstage: boolean) => async (request: Request) => {
    const body = await fields(request, 4096, ['path'], 'path is required');
    return json(await actions.stage(body.path ?? '', unstage));
  };
  return [
    {
      path: 'api/git/refresh',
      fallbackStatus: 502,
      handle: async () => json(await actions.workspace.refresh()),
    },
    {
      path: 'api/git/sync-state',
      methods: ['GET'],
      fallbackStatus: 502,
      handle: async () => json(await actions.syncState()),
    },
    mutationRoute('api/git/stage', stage(false)),
    mutationRoute('api/git/unstage', stage(true)),
    mutationRoute('api/git/hunk', async (request) => {
      const body = await fields(
        request,
        1 << 20,
        ['path', 'hunk', 'action'],
        'path, hunk, and action are required',
      );
      return json(await actions.hunk(body.path ?? '', body.hunk ?? '', body.action ?? ''));
    }),
    mutationRoute('api/git/commit', async (request) => {
      const body = await fields(request, 1 << 16, ['message'], 'message is required');
      if (!trimSpace(body.message ?? '')) return fail(400, 'message is required');
      return json(await actions.commit(body.message ?? ''));
    }),
    mutationRoute('api/git/push', async () => json(await actions.push())),
    mutationRoute('api/git/pull', async () => json(await actions.pull())),
    mutationRoute('api/git/abort', async () => json(await actions.abort())),
  ];
}
