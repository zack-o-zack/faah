import { request as httpRequest } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export function array(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !array(value);
}
export interface Reply {
  status: number;
  headers: Record<string, string | null>;
  body: unknown;
}
export interface Options {
  method?: string;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
  origin?: boolean;
  hash?: boolean;
  stableFile?: boolean;
}
export const selectedHeaders = [
  'content-type',
  'cache-control',
  'content-disposition',
  'content-encoding',
  'location',
  'x-content-type-options',
  'connection',
  'x-accel-buffering',
];
export async function request(
  baseUrl: string,
  path: string,
  options: Options = {},
): Promise<Reply> {
  const base = new URL(baseUrl);
  const headers: Record<string, string> = { 'Accept-Encoding': 'identity' };
  if (options.origin !== false) headers.Origin = base.origin;
  let payload = options.text;
  if (options.json !== undefined) {
    payload = JSON.stringify(options.json);
    headers['Content-Type'] = 'application/json';
  }
  Object.assign(headers, options.headers);
  const reply = await new Promise<Reply>((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: base.hostname,
        port: base.port,
        path: path.startsWith('/') ? path : base.pathname + path,
        method: options.method ?? 'GET',
        headers,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          try {
            let bytes = Buffer.concat(chunks);
            if (res.headers['content-encoding'] === 'gzip') bytes = gunzipSync(bytes);
            const picked: Record<string, string | null> = {};
            for (const key of selectedHeaders) {
              const value = res.headers[key];
              picked[key] = Array.isArray(value) ? value.join(', ') : (value ?? null);
            }
            let body: unknown;
            if (options.hash)
              body = {
                sha256: createHash('sha256').update(bytes).digest('hex'),
                bytes: bytes.length,
              };
            else if (res.headers['content-type']?.includes('application/json'))
              body = JSON.parse(bytes.toString());
            else if (
              res.headers['content-type']?.startsWith('image/') ||
              res.headers['content-type'] === 'application/octet-stream'
            )
              body = { base64: bytes.toString('base64') };
            else body = bytes.toString('utf8');
            resolve({ status: res.statusCode ?? 0, headers: picked, body });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.setTimeout(30000, () => req.destroy(new Error(`HTTP timeout: ${path}`)));
    req.on('error', reject);
    req.end(payload);
  });
  // Exact highlighting is asynchronous. Observe its advertised completion, never mask flags.
  if (options.stableFile && object(reply.body) && reply.body.refine === true) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      await delay(10);
      const next = await request(baseUrl, path, { ...options, stableFile: false });
      if (object(next.body) && next.body.refine === false) return next;
    }
    throw new Error(`Exact highlighting did not settle: ${path}`);
  }
  return reply;
}
export function query(route: string, params: Record<string, string | number>): string {
  return `${route}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`;
}
