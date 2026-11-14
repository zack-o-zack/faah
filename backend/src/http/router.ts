import { headers, missing, redirect } from './response.ts';
import { runRoute, type RouteTable } from './routes.ts';

export interface RouterOptions {
  base: string;
  /** Workspaces gzip eligible responses; the workbench does not. */
  gzip: boolean;
  routes: RouteTable;
  /** Called for every request under the base path, before routing. */
  onRequest?: (route: string, request: Request) => void;
}

/**
 * The HTTP adapter for one process: normalizes the base path the way Go's mux
 * did, dispatches to the route table and applies the shared response headers.
 */
export function createRouter(options: RouterOptions): (request: Request) => Promise<Response> {
  const { base, gzip, routes } = options;
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (base !== '/' && (path === '/' || path === base.slice(0, -1)))
      return headers(
        redirect(base + url.search, request.method, path === '/' ? 302 : 301),
        request,
        gzip,
      );
    if (!path.startsWith(base)) return headers(missing(), request, gzip);
    const route = path.slice(base.length);
    options.onRequest?.(route, request);
    const def = routes.find(route);
    if (!def) return headers(missing(), request, gzip);
    const response = await runRoute(def, { request, url, query: url.searchParams, route });
    return def.passthrough ? response : headers(response, request, gzip);
  };
}
