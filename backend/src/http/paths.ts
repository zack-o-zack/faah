import { posix, join } from 'node:path';
export function basePath(value: string): string {
  value = value.trim();
  if (!value || value === '.' || value === '/') return '/';
  return posix.normalize('/' + value.replace(/^\/+/, '')).replace(/\/$/, '') + '/';
}
export function safePath(root: string, value: string): string | undefined {
  const clean = posix.normalize(value.trim().replace(/^\//, ''));
  if (clean === '..' || clean.startsWith('../') || clean.startsWith('/')) return undefined;
  return join(root, clean);
}
