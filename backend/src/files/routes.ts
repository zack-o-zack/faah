import { content } from '../http/content.ts';
import { json, missing } from '../http/response.ts';
import type { RouteDef } from '../http/routes.ts';
import { decodeFileInput } from './decode.ts';
import type { FileMutations } from './mutations.ts';
import { rawFile, rawHeaders } from './service.ts';
import type { Files } from './view.ts';

async function raw(root: string, request: Request, query: URLSearchParams): Promise<Response> {
  const file = await rawFile(root, query.get('path') ?? '');
  const headers = rawHeaders(file.rel);
  if (file.directory) {
    headers.set('Location', 'raw/' + new URL(request.url).search);
    return new Response(null, { status: 301, headers });
  }
  if (file.missing) {
    const response = missing();
    response.headers.set('X-Static-Missing', '1');
    response.headers.set('Content-Disposition', headers.get('Content-Disposition') ?? '');
    return response;
  }
  return content({ bytes: file.bytes, request, headers, modified: file.modified });
}

/**
 * File windows, previews, raw downloads and edits. Save/new deliberately skip
 * Go's localPost guard, as Go does.
 */
export function fileRoutes(options: {
  root: string;
  files: Files;
  mutations: FileMutations;
}): RouteDef[] {
  const { root, files, mutations } = options;
  const write = (save: boolean): RouteDef['handle'] =>
    async function writeFile({ request }) {
      const body = decodeFileInput(new Uint8Array(await request.arrayBuffer()), save);
      return json(
        save
          ? await mutations.save(body.path, body.content)
          : await mutations.create(body.path, body.type),
      );
    };
  return [
    { path: 'api/file', handle: async ({ query }) => json(await files.file(query)) },
    {
      path: 'api/markdown',
      handle: async ({ query }) => json(await files.markdown(query.get('path') ?? '')),
    },
    {
      path: 'api/table',
      handle: async ({ query }) => json(await files.table(query.get('path') ?? '')),
    },
    {
      path: 'api/close',
      handle: async ({ query }) =>
        json(await mutations.close(query.get('path') ?? '', (path) => files.resolve(path))),
    },
    {
      path: 'api/raw',
      fallbackStatus: 400,
      handle: ({ request, query }) => raw(root, request, query),
    },
    { path: 'api/file/save', methods: ['POST'], handle: write(true) },
    { path: 'api/fs/new', methods: ['POST'], handle: write(false) },
  ];
}
