import { Settings, defaults } from './service.ts';
import { schema } from './schema.ts';
import { json, fail } from '../http/response.ts';
import { localPost } from '../http/guards.ts';
import { parseSettings } from './json.ts';
import { message } from '../decode.ts';
export async function settingsRoute(settings: Settings, request: Request): Promise<Response> {
  if (request.method === 'GET')
    return json({
      settings: settings.merged(),
      defaults: defaults(),
      schema,
      raw: settings.rawJSON(),
      path: settings.path,
    });
  if (request.method !== 'POST') return fail(405, 'method not allowed');
  const guard = localPost(
    request.method,
    request.headers.get('host') ?? '',
    request.headers.get('origin') ?? '',
  );
  if (guard) return fail(guard.status, guard.error);
  const text = (await request.text()).slice(0, 1 << 20);
  let body: Record<string, unknown>;
  try {
    body = text ? parseSettings(text) : Object.fromEntries(new URL(request.url).searchParams);
  } catch (error) {
    return fail(400, 'invalid JSON: ' + message(error));
  }
  try {
    if (typeof body.raw === 'string') settings.saveRaw(body.raw);
    else settings.update(body);
  } catch (error) {
    return fail(
      typeof body.raw === 'string' ? 400 : 500,
      (typeof body.raw === 'string' ? 'invalid JSON in settings: ' : '') + message(error),
    );
  }
  return json({
    settings: settings.merged(),
    raw: settings.rawJSON(),
    path: settings.path,
    ok: true,
  });
}
