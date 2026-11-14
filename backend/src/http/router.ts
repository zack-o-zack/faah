import { fileRoute } from '../files/routes.ts';
import { headers, missing, redirect, json } from './response.ts';
import { index, themes, staticAsset, themeName } from './assets.ts';
import { legacyProxy } from '../legacy/proxy.ts';
import { navigationRoute } from './navigation.ts';
import type { Navigation } from '../index/navigation.ts';
import { legacyOwned } from '../legacy/routes.ts';
import type { Child } from '../legacy/child.ts';
import type { Settings } from '../settings/service.ts';
import { settingsRoute } from '../settings/routes.ts';
import { MetricsCollector } from '../metrics/service.ts';
import { workspaceMetrics } from '../metrics/workspace.ts';
import type { Workbench } from '../workbench/service.ts';
import { workbenchMetrics } from '../workbench/metrics.ts';
import { workbenchRoute } from '../workbench/routes.ts';
export interface HandlerOptions {
  base: string;
  workspace: boolean;
  version: string;
  settings: Settings;
  wb: Workbench | undefined;
  legacy: Child | undefined;
  lspEnabled: boolean;
  navigation?: Navigation;
  pr?: boolean;
}
export function handler(options: HandlerOptions): (request: Request) => Promise<Response> {
  const { base, workspace, version, settings, wb, legacy, lspEnabled, navigation, pr } = options;
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
    if (pr && legacy) return legacyProxy({ request, origin: legacy.origin, route });
    if (navigation) {
      navigation.idle.request(route, request.headers.get('accept'));
      const file = await fileRoute(navigation, request, route);
      if (file) return headers(file, request, workspace);
      const response = await navigationRoute({ nav: navigation, request, route });
      if (response) return headers(response, request, workspace);
    }
    if (wb) {
      const response = await workbenchRoute({ wb, request, path: route, version, settings });
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
      response = json(
        await workspaceMetrics({ collector: metrics, child: legacy, base, lspEnabled }),
      );
    else if (legacy && legacyOwned('/' + route))
      return legacyProxy({ request, origin: legacy.origin, route, navigation });
    else response = missing();
    return headers(response, request, workspace);
  };
}
