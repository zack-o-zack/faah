import { isIP } from 'node:net';
import { fail } from './response.ts';

// Go's guards: loopback-style hosts only, and mutations must carry a matching
// Origin. Numeric non-loopback hosts and Origin scheme mismatches are accepted,
// as Go accepts them (see "Preserved Go oddities" in docs/internals/backend.md).

function trustedHost(host: string): boolean {
  const name = host.startsWith('[')
    ? (host.split(']')[0] ?? '').slice(1)
    : host.split(':').length === 2
      ? host.replace(/:\d+$/, '')
      : host;
  return name === 'localhost' || isIP(name) !== 0;
}

function requestHost(request: Request): string {
  return request.headers.get('host') ?? new URL(request.url).host;
}

/** A 403 response unless the request names the server by IP address or localhost. */
export function trustedGet(request: Request): Response | undefined {
  if (!trustedHost(requestHost(request))) return fail(403, 'open faah by IP address or localhost');
}

/** Go's `localPost`: a same-origin POST to a trusted host, or the error response. */
export function localPost(request: Request): Response | undefined {
  if (request.method !== 'POST') return fail(405, 'POST only');
  const host = requestHost(request);
  if (!trustedHost(host))
    return fail(403, 'open faah by IP address or localhost to set up language servers');
  try {
    if (new URL(request.headers.get('origin') ?? '').host === host) return;
  } catch {
    /* Invalid or absent Origin is rejected below. */
  }
  return fail(403, 'request did not come from faah');
}
