import type { Settings } from '../settings/service.ts';
import { index, staticAsset, themeName, themes } from './assets.ts';
import type { RouteDef } from './routes.ts';

/** The page shell and embedded frontend assets, shared by workspaces and the workbench. */
export function staticRoutes(options: {
  base: string;
  workbench: boolean;
  settings: Settings;
}): RouteDef[] {
  const { base, workbench, settings } = options;
  return [
    { path: '', handle: async () => index(base, workbench, await themeName(settings)) },
    {
      path: 'static/themes.css',
      handle: async () =>
        new Response(await themes(), { headers: { 'Content-Type': 'text/css; charset=utf-8' } }),
    },
    {
      path: 'static/',
      prefix: true,
      handle: ({ route, request }) => staticAsset(route.slice('static/'.length), request),
    },
  ];
}
