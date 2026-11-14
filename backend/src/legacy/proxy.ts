import type { Navigation } from '../index/navigation.ts';
import { proxy } from '../http/proxy.ts';
import { resolveFile } from '../files/service.ts';
import { record, string } from '../decode.ts';
export async function legacyProxy(options: {
  request: Request;
  origin: string;
  route: string;
  navigation?: Navigation;
}): Promise<Response> {
  const { request, origin, route, navigation } = options;
  let path: string | undefined;
  if (navigation && ['api/file/save', 'api/fs/new'].includes(route)) {
    try {
      const value: unknown = await request.clone().json();
      path = resolveFile(navigation.index.root, string(record(value).path)).rel;
    } catch {
      /* Go returns the request validation error. */
    }
  }
  const response = await proxy(request, origin);
  if (navigation) await navigation.legacy.after({ route, response, path });
  return response;
}
