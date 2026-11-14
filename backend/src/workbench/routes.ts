import { parse, string } from '../decode.ts';
import { themeName } from '../http/assets.ts';
import { localPost, trustedGet } from '../http/guards.ts';
import { proxy } from '../http/proxy.ts';
import { fail, json, missing, redirect } from '../http/response.ts';
import type { RouteDef } from '../http/routes.ts';
import type { Settings } from '../settings/service.ts';
import { holding } from './holding.ts';
import { workbenchMetrics } from './metrics.ts';
import type { Workbench } from './service.ts';

interface WorkbenchRouteOptions {
  workbench: Workbench;
  version: string;
  settings: Settings;
}

/** `/w/<id>/…`: proxy to a running child, or show its holding page while it starts. */
async function childRoute(
  { workbench, settings }: WorkbenchRouteOptions,
  request: Request,
  route: string,
): Promise<Response> {
  const rest = route.slice(2);
  const id = rest.split('/')[0] ?? '';
  if (!id) return redirect(workbench.base, request.method, 302);
  if (!rest.includes('/')) return redirect(workbench.childBase(id), request.method, 302);
  let child = workbench.children.get(id);
  if (child?.state === 'running' && child.child) {
    child.active++;
    const active = child;
    return proxy(request, child.child.origin, () => {
      active.active--;
      active.lastActive = Date.now();
    });
  }
  if (rest !== id + '/' || request.method !== 'GET')
    return fail(503, 'workspace is not running; reload the page to start it');
  const denied = trustedGet(request);
  if (denied) return denied;
  const item = workbench.store.get(id);
  const retry = Boolean(new URL(request.url).searchParams.get('retry'));
  if (item && (child?.state !== 'failed' || retry) && child?.state !== 'starting') {
    workbench.store.record(item);
    child = workbench.start(item);
  }
  return holding({
    base: workbench.base,
    theme: await themeName(settings),
    self: workbench.childBase(id),
    item,
    workspace: child,
    retry,
  });
}

const bodyErrors: Record<string, string> = {
  mkdir: 'folder name is required',
  stop: 'id is required',
  pin: 'id is required',
  remove: 'id is required',
};

/** Read Go's 16 KiB JSON body, or the action-specific "required" message. */
async function body(request: Request, action: string): Promise<Record<string, unknown>> {
  try {
    return parse((await request.text()).slice(0, 16384));
  } catch {
    throw new BodyError(bodyErrors[action] ?? 'bad request');
  }
}

class BodyError extends Error {}

async function action(
  { workbench, version }: WorkbenchRouteOptions,
  request: Request,
  name: string,
): Promise<Response> {
  const url = new URL(request.url);
  if (name === 'state') return json({ ...workbench.state(), version });
  if (name === 'browse')
    return json(
      workbench.browse(url.searchParams.get('path') ?? '', url.searchParams.get('hidden') === '1'),
    );
  if (name === 'complete') return json(workbench.complete(url.searchParams.get('q') ?? ''));
  const fields = await body(request, name);
  if (name === 'open')
    return json(workbench.open(string(fields.target), string(fields.id), string(fields.clone)));
  if (name === 'mkdir') {
    const path = string(fields.path);
    if (!path.trim()) return fail(400, 'folder name is required');
    return json(workbench.mkdir(path, string(fields.base)));
  }
  const id = string(fields.id);
  if (!id) return fail(400, 'id is required');
  if (name === 'stop') await workbench.stop(id);
  else if (name === 'remove') await workbench.remove(id);
  else if (name === 'pin') workbench.store.pin(id, fields.pinned === true);
  else return missing();
  return json({ ok: true });
}

const trustedReads = new Set(['state', 'browse', 'complete']);

/**
 * The workbench process: child workspaces under `w/`, the `api/wb/*` actions,
 * aggregate metrics and the theme-only settings writer.
 */
export function workbenchRoutes(options: WorkbenchRouteOptions): RouteDef[] {
  const { workbench, version, settings } = options;
  return [
    {
      path: 'w/',
      prefix: true,
      passthrough: true,
      handle: ({ request, route }) => childRoute(options, request, route),
    },
    { path: 'api/wb/ping', handle: () => json({ workbench: true, version }) },
    {
      path: 'api/wb/',
      prefix: true,
      fallbackStatus: 400,
      async handle({ request, route }) {
        const name = route.slice('api/wb/'.length);
        const denied = trustedReads.has(name) ? trustedGet(request) : localPost(request);
        if (denied) return denied;
        try {
          return await action(options, request, name);
        } catch (error) {
          if (error instanceof BodyError) return fail(400, error.message);
          throw error;
        }
      },
    },
    {
      // Theme picks only: the workbench has no settings page of its own.
      path: 'api/settings',
      fallbackStatus: 400,
      async handle({ request }) {
        const denied = localPost(request);
        if (denied) return denied;
        let fields: Record<string, unknown>;
        try {
          fields = await body(request, '');
        } catch (error) {
          if (error instanceof BodyError) return fail(400, error.message);
          throw error;
        }
        if (typeof fields['workbench.colorTheme'] !== 'string' || Object.keys(fields).length !== 1)
          return fail(400, 'only workbench.colorTheme can be set here');
        settings.update(fields);
        return json({ ok: true });
      },
    },
    { path: 'api/metrics', handle: async () => json(await workbenchMetrics(workbench)) },
  ];
}
