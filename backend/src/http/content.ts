export function content(options: {
  bytes: Uint8Array;
  request: Request;
  headers: Headers;
  modified?: Date;
}): Response {
  const { bytes, request, headers, modified } = options;
  headers.set('Accept-Ranges', 'bytes');
  if (modified) {
    headers.set('Last-Modified', modified.toUTCString());
    const since = request.headers.get('if-modified-since');
    if (
      since &&
      ['GET', 'HEAD'].includes(request.method) &&
      modified.getTime() < Date.parse(since) + 1000
    )
      return new Response(null, { status: 304, headers });
  }
  const range = request.headers.get('range');
  if (
    range &&
    (!request.headers.has('if-range') ||
      request.headers.get('if-range') === headers.get('Last-Modified'))
  ) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2]));
      const end =
        match[1] && match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
      if (start > end || start >= bytes.length) {
        headers.set('Content-Range', `bytes */${bytes.length}`);
        headers.set('Content-Type', 'text/plain; charset=utf-8');
        headers.set('X-Content-Type-Options', 'nosniff');
        return new Response('invalid range: failed to overlap\n', { status: 416, headers });
      }
      headers.set('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
      return new Response(new Uint8Array(bytes.slice(start, end + 1)), { status: 206, headers });
    }
  }
  return new Response(new Uint8Array(bytes), { headers });
}
