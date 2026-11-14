import { realpathSync } from 'node:fs';
import type { Database } from 'bun:sqlite';
import { staticRoutes } from '../http/static-routes.ts';
import { RouteTable } from '../http/routes.ts';
import type { ServerProcess } from '../http/server-process.ts';
import { settingsRoutes } from '../settings/routes.ts';
import type { Settings } from '../settings/service.ts';
import { workbenchRoutes } from './routes.ts';
import { Workbench } from './service.ts';
import { WorkbenchStore } from './store.ts';

/** Compose the workbench process: recents, child workspaces and the launcher page. */
export function workbenchProcess(options: {
  db: Database;
  base: string;
  version: string;
  settings: Settings;
  command: string[];
  features: string[];
}): ServerProcess {
  const { db, base, version, settings } = options;
  const workbench = new Workbench({
    store: new WorkbenchStore(db),
    base,
    cwd: realpathSync(process.cwd()),
    command: options.command,
    features: options.features,
  });
  return {
    routes: new RouteTable([
      workbenchRoutes({ workbench, version, settings }),
      staticRoutes({ base, workbench: true, settings }),
      settingsRoutes(settings),
    ]),
    gzip: false,
    close: () => workbench.close(),
  };
}
