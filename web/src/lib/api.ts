export type RequestParams = unknown;
export interface RequestOptions extends RequestInit {
  json?: boolean;
  timeout?: number;
  text?: boolean;
}
export type Request = (
  path: string,
  params?: RequestParams,
  opts?: RequestOptions,
) => Promise<unknown>;
function request(
  method: string,
  path: string,
  params: RequestParams | undefined,
  opts: RequestOptions & { text: true },
): Promise<string>;
function request(
  method: string,
  path: string,
  params?: RequestParams,
  opts?: RequestOptions,
): Promise<unknown>;
async function request(
  method: string,
  path: string,
  params?: RequestParams,
  opts: RequestOptions = {},
): Promise<unknown> {
  const relPath = path.startsWith('/') ? path.slice(1) : path;
  const base =
    document.baseURI ||
    (typeof location !== 'undefined' &&
      (location.origin ? location.origin + '/' : location.href)) ||
    'http://localhost:7777/';
  const u = new URL(relPath, base);
  const fetchOpts: RequestInit = { method, ...opts };
  const isPost = method === 'POST' || method === 'PUT' || method === 'PATCH';

  if (params) {
    const hasComplex =
      typeof params === 'object' &&
      params !== null &&
      (Array.isArray(params) ||
        Object.values(params).some((v) => typeof v === 'object' && v !== null));
    if (isPost && (opts.json || hasComplex)) {
      fetchOpts.headers = { 'Content-Type': 'application/json', ...opts.headers };
      fetchOpts.body = JSON.stringify(params);
    } else {
      for (const [k, v] of Object.entries(
        typeof params === 'object' || typeof params === 'string' ? params : {},
      )) {
        if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
      }
    }
  }

  if (
    !fetchOpts.signal &&
    typeof AbortSignal !== 'undefined' &&
    typeof AbortSignal.timeout === 'function'
  ) {
    fetchOpts.signal = AbortSignal.timeout(opts.timeout || 30000);
  }

  const r = await fetch(u, fetchOpts);
  if (opts.text) {
    if (!r.ok) throw new Error(`Request failed (${r.status})`);
    return r.text();
  }
  const j: unknown = await r.json();
  // The body rides along: some replies, like a failed agent job, carry detail beyond the message.
  if (j && typeof j === 'object' && 'error' in j && typeof j.error === 'string' && j.error)
    throw Object.assign(new Error(j.error), { body: j });
  return j;
}
export const api: Request = (path, params, opts) => request('GET', path, params, opts);
// For requests that change the machine; the server only accepts these as POST from this page.
export const apiPost: Request = (path, params, opts) => request('POST', path, params, opts);
export const apiPostJson: Request = (path, params, opts) =>
  request('POST', path, params, { json: true, ...opts });

export const apiText = (
  path: string,
  params?: RequestParams,
  opts?: RequestOptions,
): Promise<string> => request('GET', path, params, { ...opts, text: true });
