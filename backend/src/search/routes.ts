import { json } from '../http/response.ts';
import type { RouteDef } from '../http/routes.ts';
import type { Search } from './service.ts';

export function searchRoutes(search: Search): RouteDef[] {
  return [
    {
      path: 'api/search',
      fallbackStatus: 400,
      async handle({ query, request }) {
        const result = await search.search(
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
          total: result.results.reduce((count, file) => count + file.matches.length, 0),
        });
      },
    },
  ];
}
