import { fail, json } from '../http/response.ts';
import { message } from '../decode.ts';
import { atoi } from './commands.ts';
import type { GitReads } from './reads.ts';

const reads = new Set(['api/git/log', 'api/unpushed', 'api/commitfiles', 'api/commitdetail']);
export async function gitReadRoute(
  git: GitReads,
  request: Request,
  route: string,
): Promise<Response | undefined> {
  if (route !== 'api/diff' && route !== 'api/gutter' && !reads.has(route)) return;
  if (reads.has(route) && request.method !== 'GET') return fail(405, 'method not allowed');
  const query = new URL(request.url).searchParams;
  try {
    const path = query.get('path') ?? '',
      ref = query.get('ref') ?? '';
    if (route === 'api/diff')
      return json(await git.fileDiff({ path, ref, base: query.get('base') ?? '' }));
    if (route === 'api/gutter') return json(await git.gutter(path, ref));
    if (route === 'api/git/log') {
      const limit = atoi(query.get('limit') ?? '') ?? 0;
      return json(await git.log(limit > 0 && limit <= 50 ? limit : 5));
    }
    if (route === 'api/unpushed')
      return json(await git.unpushed(atoi(query.get('limit') ?? '') ?? 0));
    const sha = query.get('sha') ?? '';
    if (route === 'api/commitfiles') return json(await git.files(sha));
    const detail = await git.detail(sha);
    return detail ? json(detail) : fail(404, 'unknown commit');
  } catch (error) {
    return fail(400, message(error));
  }
}
