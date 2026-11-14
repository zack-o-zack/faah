import { trackStream } from './stream.ts';
import { fail } from './response.ts';
export async function proxy(
  request: Request,
  origin: string,
  onDone?: () => void,
): Promise<Response> {
  let finished = false;
  const done = () => {
    if (!finished) {
      finished = true;
      onDone?.();
    }
  };
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, origin);
  const headers = new Headers(request.headers);
  headers.set('host', request.headers.get('host') ?? url.host);
  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      body: request.body,
      signal: request.signal,
      redirect: 'manual',
      decompress: false,
    });
    return new Response(onDone ? trackStream(response.body, done) : response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (error) {
    done();
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return fail(502, `workspace is not responding: ${String(error)}`);
  }
}
