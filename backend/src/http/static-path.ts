import { posix } from 'node:path';
export function staticCandidates(rel: string): string[] {
  rel = posix.normalize(rel.replace(/^\//, ''));
  if (rel === '.' || rel.startsWith('..')) return [];
  return ['web/dist/' + rel, 'web/' + rel + '.gz', 'web/' + rel];
}
