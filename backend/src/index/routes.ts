import { atoi } from '../compat/go-numbers.ts';
import { json } from '../http/response.ts';
import type { RouteDef } from '../http/routes.ts';
import type { IndexQueries } from './queries.ts';

export function indexRoutes(queries: IndexQueries): RouteDef[] {
  return [
    {
      path: 'api/tree',
      fallbackStatus: 400,
      handle: async ({ query }) =>
        json(await queries.tree(query.get('dir') ?? '', query.get('compact') ?? '')),
    },
    {
      path: 'api/find',
      fallbackStatus: 400,
      handle: async ({ query }) =>
        json(await queries.find(query.get('q') ?? '', atoi(query.get('limit') ?? '') ?? 0)),
    },
  ];
}
