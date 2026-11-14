import { localPost } from '../http/guards.ts';
import { sessionJSON } from './json.ts';
import type { WorkspaceSession } from './model.ts';
import type { RouteDef } from '../http/routes.ts';
import { decodeSessionUpdate } from './compat.ts';
import type { Session } from './service.ts';

function response(session: WorkspaceSession): Response {
  return new Response(sessionJSON(session) + '\n', {
    headers: { 'Content-Type': 'application/json' },
  });
}

export function sessionRoutes(session: Session): RouteDef[] {
  return [
    {
      path: 'api/session',
      methods: ['GET', 'POST'],
      async handle({ request }) {
        if (request.method === 'GET') return response(session.get());
        const refused = localPost(request);
        if (refused) return refused;
        const input = new Uint8Array(await request.arrayBuffer()).subarray(0, 1 << 20);
        return response(session.update(decodeSessionUpdate(input)));
      },
    },
  ];
}
