import { json, fail } from '../http/response.ts';
import { PathError } from './service.ts';
import { message } from '../decode.ts';
import { decodeFileInput } from './decode.ts';
import type { Navigation } from '../index/navigation.ts';
export async function fileRoute(
  nav: Navigation,
  request: Request,
  route: string,
): Promise<Response | undefined> {
  const query = new URL(request.url).searchParams;
  try {
    if (route === 'api/file') return json(await nav.files.file(query));
    if (route === 'api/markdown') return json(await nav.files.markdown(query.get('path') ?? ''));
    if (route === 'api/table') return json(await nav.files.table(query.get('path') ?? ''));
    if (route === 'api/close')
      return json(
        await nav.fileMutations.close(query.get('path') ?? '', (path) => nav.files.resolve(path)),
      );
    if (route !== 'api/file/save' && route !== 'api/fs/new') return;
    if (request.method !== 'POST') return fail(405, 'method not allowed');
    const body = decodeFileInput(
      new Uint8Array(await request.arrayBuffer()),
      route === 'api/file/save',
    );
    return json(
      route === 'api/file/save'
        ? await nav.fileMutations.save(body.path, body.content)
        : await nav.fileMutations.create(body.path, body.type),
    );
  } catch (error) {
    return fail(error instanceof PathError ? error.status : 500, message(error));
  }
}
