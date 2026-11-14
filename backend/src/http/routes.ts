import { errorResponse } from './errors.ts';
import { fail } from './response.ts';

/** What a route handler receives; `route` is the path relative to the base path. */
export interface RouteContext {
  readonly request: Request;
  readonly url: URL;
  readonly query: URLSearchParams;
  readonly route: string;
}

/**
 * One HTTP route, declared by the feature that owns it. Handlers decode the
 * request, call a service and encode its result; thrown errors are mapped by
 * `errorResponse`.
 */
export interface RouteDef {
  /** Exact path relative to the base, or a path prefix when `prefix` is set. */
  readonly path: string;
  readonly prefix?: boolean;
  /** Allowed methods; others get Go's `405 method not allowed`. Omit to accept all. */
  readonly methods?: readonly string[];
  /** Status for unexpected errors. Defaults to 500. */
  readonly fallbackStatus?: number;
  /** Return the response without the shared headers: proxies and child pages own theirs. */
  readonly passthrough?: boolean;
  handle(context: RouteContext): Promise<Response> | Response;
}

/**
 * Exact and prefix routes from several features. When two features declare
 * the same path, the group passed first wins, so a process can override a
 * shared route (the workbench's theme-only `api/settings`).
 */
export class RouteTable {
  private readonly exact = new Map<string, RouteDef>();
  private readonly prefixes: RouteDef[] = [];

  constructor(groups: readonly (readonly RouteDef[])[]) {
    for (const route of groups.flat()) {
      if (route.prefix) this.prefixes.push(route);
      else if (!this.exact.has(route.path)) this.exact.set(route.path, route);
    }
  }

  find(route: string): RouteDef | undefined {
    return this.exact.get(route) ?? this.prefixes.find((def) => route.startsWith(def.path));
  }
}

export async function runRoute(def: RouteDef, context: RouteContext): Promise<Response> {
  if (def.methods && !def.methods.includes(context.request.method))
    return fail(405, 'method not allowed');
  try {
    return await def.handle(context);
  } catch (error) {
    return errorResponse(error, context.request.signal, def.fallbackStatus ?? 500);
  }
}
