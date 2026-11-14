import { holding } from './holding.ts';
import { themeName } from '../http/assets.ts';
import { Workbench, ServiceError } from './service.ts';
import { localPost, trustedGet } from '../http/guards.ts';
import { json, fail, missing, redirect } from '../http/response.ts';
import { proxy } from '../http/proxy.ts';
import { parse, string, message } from '../decode.ts';
import { Settings } from '../settings/service.ts';
export async function workbenchRoute(options: {
  wb: Workbench;
  request: Request;
  path: string;
  version: string;
  settings: Settings;
}): Promise<Response | undefined> {
  const { wb, request, path, version, settings } = options;
  if (path.startsWith('w/')) {
    const rest = path.slice(2);
    const id = rest.split('/')[0] ?? '';
    if (!id) return redirect(wb.base, request.method, 302);
    if (!rest.includes('/')) return redirect(wb.childBase(id), request.method, 302);
    let ws = wb.children.get(id);
    if (ws?.state === 'running' && ws.child) {
      ws.active++;
      const active = ws;
      return proxy(request, ws.child.origin, () => {
        active.active--;
        active.lastActive = Date.now();
      });
    }
    if (rest !== id + '/' || request.method !== 'GET')
      return fail(503, 'workspace is not running; reload the page to start it');
    const guard = trustedGet(request.headers.get('host') ?? '');
    if (guard) return fail(guard.status, guard.error);
    const item = wb.store.get(id);
    const retry = Boolean(new URL(request.url).searchParams.get('retry'));
    if (item && (ws?.state !== 'failed' || retry)) {
      if (ws?.state !== 'starting') {
        wb.store.record(item);
        ws = wb.start(item);
      }
    }
    return holding({
      base: wb.base,
      theme: await themeName(settings),
      self: wb.childBase(id),
      item,
      workspace: ws,
      retry,
    });
  }
  if (path === 'api/wb/ping') return json({ workbench: true, version });
  if (!path.startsWith('api/wb/') && path !== 'api/settings') return;
  const action = path.slice('api/wb/'.length);
  const url = new URL(request.url);
  const host = request.headers.get('host') ?? '';
  const guard = ['state', 'browse', 'complete'].includes(action)
    ? trustedGet(host)
    : localPost(request.method, host, request.headers.get('origin') ?? '');
  if (guard) return fail(guard.status, guard.error);
  try {
    if (action === 'state') return json({ ...wb.state(), version });
    if (action === 'browse')
      return json(
        wb.browse(url.searchParams.get('path') ?? '', url.searchParams.get('hidden') === '1'),
      );
    if (action === 'complete') return json(wb.complete(url.searchParams.get('q') ?? ''));
    let body: Record<string, unknown>;
    try {
      body = parse((await request.text()).slice(0, 16384));
    } catch {
      return fail(
        400,
        action === 'mkdir'
          ? 'folder name is required'
          : ['stop', 'pin', 'remove'].includes(action)
            ? 'id is required'
            : 'bad request',
      );
    }
    if (path === 'api/settings') {
      if (typeof body['workbench.colorTheme'] !== 'string' || Object.keys(body).length !== 1)
        return fail(400, 'only workbench.colorTheme can be set here');
      settings.update(body);
      return json({ ok: true });
    }
    if (action === 'open')
      return json(wb.open(string(body.target), string(body.id), string(body.clone)));
    if (action === 'mkdir') {
      const path = string(body.path);
      if (!path.trim()) return fail(400, 'folder name is required');
      return json(wb.mkdir(path, string(body.base)));
    }
    const id = string(body.id);
    if (!id) return fail(400, 'id is required');
    if (action === 'stop') await wb.stop(id);
    else if (action === 'remove') await wb.remove(id);
    else if (action === 'pin') wb.store.pin(id, body.pinned === true);
    else return missing();
    return json({ ok: true });
  } catch (error) {
    return fail(error instanceof ServiceError ? error.status : 400, message(error));
  }
}
