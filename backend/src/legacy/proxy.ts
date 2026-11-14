import { proxy } from '../http/proxy.ts';
import type { RouteDef } from '../http/routes.ts';
import type { LegacyConsistency } from './consistency.ts';
import { legacyRoutes } from './routes.ts';

/** Routes still served by the hidden Go server, forwarded with their headers intact. */
export function legacyProxyRoutes(origin: string, consistency?: LegacyConsistency): RouteDef[] {
  return legacyRoutes.map((path) => ({
    path: path.slice(1),
    passthrough: true,
    async handle({ request, route }) {
      const response = await proxy(request, origin);
      await consistency?.after(route, request, response);
      return response;
    },
  }));
}

/** Everything under the base path forwarded to Go, for workspaces Bun does not serve yet. */
export function legacyCatchAll(origin: string): RouteDef[] {
  return [
    { path: '', prefix: true, passthrough: true, handle: ({ request }) => proxy(request, origin) },
  ];
}
