import { errorMessage } from '../errors.ts';
import { localPost } from '../http/guards.ts';
import { fail, json } from '../http/response.ts';
import type { RouteDef } from '../http/routes.ts';
import { parseSettings } from './json.ts';
import { schema } from './schema.ts';
import { defaults, type Settings } from './service.ts';

async function update(settings: Settings, request: Request): Promise<Response> {
  const text = (await request.text()).slice(0, 1 << 20);
  let body: Record<string, unknown>;
  try {
    body = text ? parseSettings(text) : Object.fromEntries(new URL(request.url).searchParams);
  } catch (error) {
    return fail(400, 'invalid JSON: ' + errorMessage(error));
  }
  const raw = typeof body.raw === 'string' ? body.raw : undefined;
  try {
    if (raw === undefined) settings.update(body);
    else settings.saveRaw(raw);
  } catch (error) {
    return raw === undefined
      ? fail(500, errorMessage(error))
      : fail(400, 'invalid JSON in settings: ' + errorMessage(error));
  }
  return json({
    settings: settings.merged(),
    raw: settings.rawJSON(),
    path: settings.path,
    ok: true,
  });
}

export function settingsRoutes(settings: Settings): RouteDef[] {
  return [
    {
      path: 'api/settings',
      methods: ['GET', 'POST'],
      handle({ request }) {
        if (request.method === 'GET')
          return json({
            settings: settings.merged(),
            defaults: defaults(),
            schema,
            raw: settings.rawJSON(),
            path: settings.path,
          });
        return localPost(request) ?? update(settings, request);
      },
    },
  ];
}
