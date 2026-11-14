import { detectPR, resolveTarget } from '../cli/target.ts';
import type { Flags } from '../cli/flags.ts';
import { staticRoutes } from '../http/static-routes.ts';
import { RouteTable, type RouteDef } from '../http/routes.ts';
import type { ServerProcess } from '../http/server-process.ts';
import { legacyCatchAll } from '../legacy/proxy.ts';
import { startLegacy } from '../legacy/start.ts';
import { metricsRoutes } from '../metrics/routes.ts';
import { MetricsCollector } from '../metrics/service.ts';
import { workspaceMetrics } from '../metrics/workspace.ts';
import { settingsRoutes } from '../settings/routes.ts';
import type { Settings } from '../settings/service.ts';
import { Workspace } from './workspace.ts';

/** The workbench URL a child reports in meta: its base path up to `/w/`. */
function workbenchURL(base: string, child: boolean): string {
  if (!child) return '';
  return base.includes('/w/') ? base.slice(0, base.lastIndexOf('/w/') + 1) : '/';
}

/**
 * Compose a workspace process: the Go child for unported routes, the Bun
 * workspace services, and the shared static/settings/metrics routes. Pull
 * request URLs are still served entirely by Go.
 */
export async function workspaceProcess(options: {
  flags: Flags;
  base: string;
  version: string;
  settings: Settings;
}): Promise<ServerProcess> {
  const { flags, base, version, settings } = options;
  const target = flags.targets[0] ?? '.';
  const legacy = await startLegacy(flags, base);
  const workspace = detectPR(target)
    ? undefined
    : new Workspace({
        root: resolveTarget(target).root,
        base,
        version,
        workbench: workbenchURL(base, flags.bool.has('workbench-child')),
        gitEnabled: !flags.bool.has('no-git'),
        legacy,
      });
  const collector = new MetricsCollector();
  const metrics = () =>
    workspaceMetrics({
      collector,
      child: legacy,
      base,
      lspEnabled: !flags.bool.has('no-lsp'),
      extraPids: workspace?.helperPids() ?? [],
    });
  const groups: (readonly RouteDef[])[] = workspace
    ? [
        workspace.routes,
        staticRoutes({ base, workbench: false, settings }),
        settingsRoutes(settings),
        metricsRoutes(metrics),
      ]
    : [legacyCatchAll(legacy.origin)];
  return {
    routes: new RouteTable(groups),
    gzip: true,
    onRequest: (route, request) => workspace?.onRequest(route, request),
    async close() {
      await workspace?.close();
      await legacy.stop(1500);
    },
  };
}
