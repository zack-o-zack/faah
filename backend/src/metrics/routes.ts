import { json } from '../http/response.ts';
import type { RouteDef } from '../http/routes.ts';

export function metricsRoutes(collect: () => Promise<unknown>): RouteDef[] {
  return [{ path: 'api/metrics', handle: async () => json(await collect()) }];
}
