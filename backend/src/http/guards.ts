import { isIP } from 'node:net';
export interface Failure {
  status: number;
  error: string;
}
function trustedHost(host: string): boolean {
  const name = host.startsWith('[')
    ? (host.split(']')[0] ?? '').slice(1)
    : host.split(':').length === 2
      ? host.replace(/:\d+$/, '')
      : host;
  return name === 'localhost' || isIP(name) !== 0;
}
export function trustedGet(host: string): Failure | undefined {
  if (!trustedHost(host)) return { status: 403, error: 'open faah by IP address or localhost' };
}
export function localPost(method: string, host: string, origin: string): Failure | undefined {
  if (method !== 'POST') return { status: 405, error: 'POST only' };
  if (!trustedHost(host))
    return {
      status: 403,
      error: 'open faah by IP address or localhost to set up language servers',
    };
  try {
    if (new URL(origin).host === host) return;
  } catch {
    /* Invalid or absent Origin is rejected below. */
  }
  return { status: 403, error: 'request did not come from faah' };
}
