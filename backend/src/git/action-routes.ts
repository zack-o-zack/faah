import { json, fail } from '../http/response.ts';
import { localPost } from '../http/guards.ts';
import { PathError } from '../files/service.ts';
import { decodeStringFields } from '../files/decode.ts';
import { trimSpace } from '../text.ts';
import { message } from '../decode.ts';
import { GitActions, SyncConflict } from './actions.ts';
const actions = new Set(['stage', 'unstage', 'hunk', 'commit', 'push', 'pull', 'abort']);
async function input(
  request: Request,
  cap: number,
  fields: string[],
  required: string,
): Promise<Record<string, string>> {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (reader)
      while (size < cap) {
        const part = await reader.read();
        if (part.done) break;
        const data = part.value.subarray(0, cap - size);
        chunks.push(data);
        size += data.length;
      }
    const bytes = Buffer.concat(chunks, size);
    const body = decodeStringFields(bytes, fields);
    if (fields.some((field) => !body[field])) throw new Error('missing field');
    return body;
  } catch {
    throw new PathError(400, required);
  } finally {
    await reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
  }
}
export async function gitActionRoute(
  git: GitActions,
  request: Request,
  route: string,
): Promise<Response | undefined> {
  if (!route.startsWith('api/git/')) return;
  const action = route.slice(8);
  if (action !== 'refresh' && action !== 'sync-state' && !actions.has(action)) return;
  if (actions.has(action)) {
    const denied = localPost(
      request.method,
      request.headers.get('host') ?? new URL(request.url).host,
      request.headers.get('origin') ?? '',
    );
    if (denied) return fail(denied.status, denied.error);
  }
  try {
    if (action === 'refresh') return json(await git.workspace.refresh());
    if (action === 'sync-state')
      return request.method === 'GET'
        ? json(await git.syncState())
        : fail(405, 'method not allowed');
    if (action === 'stage' || action === 'unstage') {
      const body = await input(request, 4096, ['path'], 'path is required');
      return json(await git.stage(body.path ?? '', action === 'unstage'));
    }
    if (action === 'hunk') {
      const body = await input(
        request,
        1 << 20,
        ['path', 'hunk', 'action'],
        'path, hunk, and action are required',
      );
      return json(await git.hunk(body.path ?? '', body.hunk ?? '', body.action ?? ''));
    }
    if (action === 'commit') {
      const body = await input(request, 1 << 16, ['message'], 'message is required');
      if (!trimSpace(body.message ?? '')) return fail(400, 'message is required');
      return json(await git.commit(body.message ?? ''));
    }
    if (action === 'push') return json(await git.push());
    if (action === 'pull') return json(await git.pull());
    return json(await git.abort());
  } catch (error) {
    if (error instanceof SyncConflict) return json({ error: error.message, ...error.state }, 409);
    return fail(error instanceof PathError ? error.status : 502, message(error));
  }
}
