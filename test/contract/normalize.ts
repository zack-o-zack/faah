import type { Fixture } from './fixtures.ts';
import { object, array } from './transport.ts';

export interface Normalization {
  fixture: Fixture;
  baseUrl: string;
  workspaceId?: string | undefined;
}
const metricKeys = new Set(['rssBytes', 'peakRSSBytes', 'cpuUsage', 'goroutines', 'lspMemBytes']);
// No recursive key-name/time/hash heuristics: rules apply only to specified routes/objects.
export function normalize(value: unknown, route: string, context: Normalization): unknown {
  const pathname = route.split('?')[0] ?? route;
  const isMeta = pathname.endsWith('/api/meta') || pathname === 'api/meta';
  const gitDates = [
    'api/git/refresh',
    'api/git/stage',
    'api/git/unstage',
    'api/git/log',
    'api/unpushed',
    'api/commitdetail',
  ];
  const isGit = gitDates.includes(pathname);
  const isWorkbench = pathname.startsWith('api/wb/');
  function visit(item: unknown, keys: string[]): unknown {
    const key = keys.at(-1);
    if (typeof item === 'number') {
      if (
        (isMeta && keys.length === 2 && key === 'indexMs') ||
        (pathname === 'api/reindex' && key === 'indexMs')
      )
        return 0;
      if (
        metricKeys.has(key ?? '') &&
        (pathname === 'metrics' ||
          pathname === 'api/metrics' ||
          (isMeta && keys.includes('metrics')))
      )
        return 0;
      if (isWorkbench && key === 'lastOpened') return 0;
    }
    if (typeof item === 'string') {
      if (isGit && key === 'date') return '<RELATIVE_DATE>';
      if ((isMeta || isWorkbench) && key === 'version') return '<VERSION>';
      if (isMeta && key === 'builtAt') return '<TIME>';
      let result = item;
      if (context.workspaceId && (isWorkbench || isMeta))
        result = result.replaceAll(context.workspaceId, '<WORKSPACE_ID>');
      for (const [from, to] of [
        [context.fixture.root, '<ROOT>'],
        [context.fixture.temp, '<TEMP>'],
        [new URL(context.baseUrl).origin, '<ORIGIN>'],
      ]) {
        if (from !== undefined && to !== undefined) result = result.replaceAll(from, to);
      }
      return result;
    }
    if (array(item)) return item.map((entry, i) => visit(entry, [...keys, String(i)]));
    if (object(item))
      return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, visit(v, [...keys, k])]));
    return item;
  }
  return visit(value, []);
}
