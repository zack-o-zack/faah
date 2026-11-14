import { Navigation } from '../index/navigation.ts';
import { PathError, rawFile, rawHeaders } from '../files/service.ts';
import { content } from './content.ts';
import { json, fail, missing } from './response.ts';
import { message } from '../decode.ts';
async function raw(nav: Navigation, request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const file = await rawFile(nav.index.root, query.get('path') ?? '');
  const headers = rawHeaders(file.rel);
  if (file.directory) {
    headers.set('Location', 'raw/' + new URL(request.url).search);
    return new Response(null, { status: 301, headers });
  }
  if (file.missing) {
    const response = missing();
    response.headers.set('X-Static-Missing', '1');
    response.headers.set('Content-Disposition', headers.get('Content-Disposition') ?? '');
    return response;
  }
  return content({ bytes: file.bytes, request, headers, modified: file.modified });
}
export async function navigationRoute(options: {
  nav: Navigation;
  request: Request;
  route: string;
}): Promise<Response | undefined> {
  const { nav, request, route } = options;
  const query = new URL(request.url).searchParams;
  try {
    if (route === 'api/meta') return json(await nav.meta());
    if (route === 'api/tree')
      return json(
        await nav.tree({ dir: query.get('dir') ?? '', compact: query.get('compact') ?? '' }),
      );
    if (route === 'api/find')
      return json(
        await nav.find({ query: query.get('q') ?? '', limit: integer(query.get('limit')) }),
      );
    if (route === 'api/reindex') return json(await nav.reindex());
    if (route === 'api/raw') return await raw(nav, request);
    if (route === 'api/outline') return json(await nav.outline(query.get('path') ?? ''));
    if (route === 'api/search') {
      const result = await nav.search.search(
        {
          query: query.get('q') ?? '',
          regex: query.get('re') === '1',
          case: query.get('case') === '1',
          word: query.get('word') === '1',
          glob: query.get('glob') ?? '',
        },
        request.signal,
      );
      return json({
        ...result,
        files: result.results.length,
        total: result.results.reduce((n, f) => n + f.matches.length, 0),
      });
    }
    if (route === 'api/def') {
      return json(
        await nav.definitions(
          { symbol: query.get('sym') ?? '', path: query.get('path') ?? '' },
          request.signal,
        ),
      );
    }
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return fail(error instanceof PathError ? error.status : 400, message(error));
  }
}

function integer(text: string | null): number {
  return text && /^[+-]?\d+$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : 0;
}
