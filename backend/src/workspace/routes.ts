import type { WorkspaceStreams } from '../http/workspace-streams.ts';
import { json } from '../http/response.ts';
import type { RouteDef } from '../http/routes.ts';
import type { WorkspaceMeta } from './meta.ts';

export function workspaceRoutes(meta: WorkspaceMeta, streams: WorkspaceStreams): RouteDef[] {
  return [
    { path: 'api/meta', fallbackStatus: 400, handle: async () => json(await meta.meta()) },
    { path: 'api/reindex', fallbackStatus: 400, handle: async () => json(await meta.reindex()) },
    {
      path: 'api/stream',
      handle: ({ request, query }) => streams.response(request.signal, query, true),
    },
    {
      path: 'api/git/stream',
      handle: ({ request, query }) => streams.response(request.signal, query, false),
    },
  ];
}
