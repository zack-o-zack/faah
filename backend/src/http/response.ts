export const csp =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https: http:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none';";
export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value) + '\n', {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
export function fail(status: number, error: string): Response {
  return json({ error }, status);
}
export function missing(): Response {
  return new Response('404 page not found\n', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
  });
}
export async function headers(
  response: Response,
  request: Request,
  gzip: boolean,
): Promise<Response> {
  if (request.headers.get('connection')?.toLowerCase() === 'close')
    response.headers.set('Connection', 'close');
  if (!response.headers.has('X-Static-Missing'))
    response.headers.set('Cache-Control', response.headers.get('Cache-Control') ?? 'no-store');
  response.headers.delete('X-Static-Missing');
  response.headers.set('Content-Security-Policy', csp);
  if ([204, 304].includes(response.status)) {
    response.headers.delete('Content-Encoding');
    return response;
  }
  if (
    gzip &&
    request.headers.get('accept-encoding')?.includes('gzip') &&
    !response.headers.has('Content-Encoding') &&
    request.headers.get('accept') !== 'text/event-stream'
  ) {
    response.headers.set('Content-Encoding', 'gzip');
    response.headers.set('Vary', 'Accept-Encoding');
    return new Response(Bun.gzipSync(await response.arrayBuffer()), {
      status: response.status,
      headers: response.headers,
    });
  }
  return response;
}
export function redirect(location: string, method: string, status = 301): Response {
  const body =
    method === 'GET'
      ? `<a href="${location}">${status === 302 ? 'Found' : 'Moved Permanently'}</a>.\n\n`
      : '';
  return new Response(body, {
    status,
    headers: {
      Location: location,
      ...(method === 'GET' ? { 'Content-Type': 'text/html; charset=utf-8' } : {}),
    },
  });
}
