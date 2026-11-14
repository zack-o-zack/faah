import { json } from '../http/response.ts';
import type { RouteDef } from '../http/routes.ts';
import type { SymbolLookup } from './lookup.ts';

export function symbolRoutes(lookup: SymbolLookup): RouteDef[] {
  return [
    {
      path: 'api/outline',
      fallbackStatus: 400,
      handle: async ({ query }) => json(await lookup.outline(query.get('path') ?? '')),
    },
    {
      path: 'api/def',
      fallbackStatus: 400,
      handle: async ({ query, request }) =>
        json(
          await lookup.definitions(query.get('sym') ?? '', query.get('path') ?? '', request.signal),
        ),
    },
  ];
}
