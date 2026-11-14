import { headers, missing, redirect, json } from './response.ts';
import { index, themes, staticAsset, themeName } from './assets.ts';
import { proxy } from './proxy.ts';
import { legacyOwned } from '../legacy/routes.ts';
import type { Child } from '../legacy/child.ts';
import type { Settings } from '../settings/service.ts';
import { settingsRoute } from '../settings/routes.ts';
import { MetricsCollector } from '../metrics/service.ts';
import { workspaceMetrics } from '../metrics/workspace.ts';
import type { Workbench } from '../workbench/service.ts';
import { workbenchMetrics } from '../workbench/metrics.ts';
import { workbenchRoute } from '../workbench/routes.ts';
export function handler(
  base: string,
  workspace: boolean,
  version: string,
  settings: Settings,
  wb: Workbench | undefined,
  legacy: Child | undefined,
  lspEnabled: boolean,
): (request: Request) => Promise<Response> {
  const metrics = new MetricsCollector();
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (base !== '/' && (path === '/' || path === base.slice(0, -1)))
      return headers(
        redirect(base + url.search, request.method, path === '/' ? 302 : 301),
        request,
        workspace,
      );
    if (!path.startsWith(base)) return headers(missing(), request, workspace);
    const route = path.slice(base.length);
    if (wb) {
      const response = await workbenchRoute(wb, request, route, version, settings);
      if (response) return route.startsWith('w/') ? response : headers(response, request, false);
    }
    let response: Response;
    if (!route) response = await index(base, Boolean(wb), await themeName(settings));
    else if (route === 'static/themes.css')
      response = new Response(await themes(), {
        headers: { 'Content-Type': 'text/css; charset=utf-8' },
      });
    else if (route.startsWith('static/')) response = await staticAsset(route.slice(7), request);
    else if (route === 'api/settings') response = await settingsRoute(settings, request);
    else if (route === 'api/metrics' && wb) response = json(await workbenchMetrics(wb));
    else if (route === 'api/metrics')
      response = json(await workspaceMetrics(metrics, legacy, base, lspEnabled));
    else if (legacy && legacyOwned('/' + route)) return proxy(request, legacy.origin);
    else response = missing();
    return headers(response, request, workspace);
  };
}
