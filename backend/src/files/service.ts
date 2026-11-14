import { stat } from 'node:fs/promises';
import { relative, basename, extname } from 'node:path';
import { safePath } from '../http/paths.ts';
export class PathError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export function resolveFile(root: string, path: string): { abs: string; rel: string } {
  const abs = safePath(root, path);
  if (!abs) throw new PathError(400, 'bad path');
  return { abs, rel: relative(root, abs) };
}
export async function rawFile(root: string, path: string) {
  const { abs, rel } = resolveFile(root, path);
  const info = await stat(abs).catch(() => undefined);
  if (!info)
    return { rel, missing: true, directory: false, bytes: new Uint8Array(), modified: undefined };
  return {
    rel,
    missing: false,
    directory: info.isDirectory(),
    bytes: info.isDirectory() ? new Uint8Array() : await Bun.file(abs).bytes(),
    modified: info.mtime,
  };
}
const image: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
};
export function rawHeaders(rel: string): Headers {
  const name = basename(rel || '.'),
    ext = extname(rel).toLowerCase();
  let filename: string;
  if (/[^\x20-\x7e]/.test(name))
    filename =
      "filename*=utf-8''" +
      encodeURIComponent(name).replace(
        /[!'()*]/g,
        (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
      );
  else
    filename =
      'filename=' +
      (/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)
        ? name
        : '"' + name.replace(/["\\]/g, '\\$&') + '"');
  return new Headers({
    'Content-Type': image[ext] ?? 'application/octet-stream',
    'Content-Disposition': 'attachment; ' + filename,
    'X-Content-Type-Options': 'nosniff',
  });
}
export function fileError(error: unknown, abs: string, operation = 'open'): string {
  const messages: Record<string, string> = {
    ENOENT: 'no such file or directory',
    EACCES: 'permission denied',
    EPERM: 'operation not permitted',
    ENOTDIR: 'not a directory',
    EISDIR: 'is a directory',
    ELOOP: 'too many levels of symbolic links',
    ENAMETOOLONG: 'file name too long',
    EROFS: 'read-only file system',
    ENOSPC: 'no space left on device',
  };
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    const message = messages[error.code];
    if (message) return operation + ' ' + abs + ': ' + message;
  }
  return error instanceof Error ? error.message : String(error);
}
