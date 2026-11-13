import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { command, object, str } from './util.ts';
import type { Spec } from './http.ts';

export async function fixtures(dir: string) {
  const tracked = (await command(['git', 'ls-files'], dir)).split('\n').sort();
  const sources = [];
  for (const path of tracked) {
    if (!/\.(py|go|c|h|js|jsx|ts|tsx|rs)$/.test(path)) continue;
    const info = await stat(join(dir, path)).catch(() => undefined);
    if (!info?.isFile() || info.size >= 2e6 || info.size < 1000) continue;
    sources.push({ path, size: info.size });
  }
  sources.sort((a, b) => b.size - a.size || a.path.localeCompare(b.path));
  const large = sources[0];
  if (!large) throw new Error('No source file');
  let typical = large.path;
  let distance = Infinity;
  for (const file of sources.filter((s) => s.size >= 4000 && s.size <= 24000).slice(0, 500)) {
    const lines = (await readFile(join(dir, file.path), 'utf8')).split('\n').length;
    if (Math.abs(lines - 300) < distance) {
      typical = file.path;
      distance = Math.abs(lines - 300);
    }
  }
  const content = await readFile(join(dir, large.path), 'utf8');
  const typicalContent = await readFile(join(dir, typical), 'utf8');
  const words = typicalContent.match(/\b[A-Za-z_][A-Za-z_0-9]{5,}\b/g) ?? [];
  const rare = [...new Set(words)].find(
    (w) => !['return', 'import', 'const', 'function', 'Copyright'].includes(w),
  );
  if (!rare) throw new Error('No rare identifier');
  const symbol =
    /^\s*(?:export\s+)?(?:async\s+)?(?:func|def|function)\s+(?:\([^)]*\)\s*)?(\w+)/m.exec(
      typicalContent,
    )?.[1] ??
    /^[A-Za-z_][\w \t*&]*?\b(\w+)\s*\([^;\n]*\)\s*\{/m.exec(typicalContent)?.[1] ??
    rare;
  const readme =
    tracked.find((p) => /^readme\.md$/i.test(p)) ?? tracked.find((p) => /readme.*\.md$/i.test(p));
  if (!readme) throw new Error('No Markdown README');
  let csv: string | undefined;
  let csvLines = -1;
  for (const path of tracked.filter((p) => extname(p) === '.csv')) {
    const lines = (await readFile(join(dir, path), 'utf8')).split('\n').length;
    if (lines > csvLines) {
      csv = path;
      csvLines = lines;
    }
  }
  const findQueries = [
    large.path,
    typical,
    sources[Math.floor(sources.length / 2)]?.path ?? typical,
  ].map((p) => basename(p).slice(0, -extname(p).length));
  return {
    large: large.path,
    largeLines: content.split('\n').length,
    typical,
    rare,
    symbol,
    readme,
    csv,
    deep: dirname(typical),
    findQueries,
    modified: typical,
    original: typicalContent,
  };
}
export type Fixtures = Awaited<ReturnType<typeof fixtures>>;
export function scenarios(f: Fixtures): Spec[] {
  const spec = (name: string, route: string, params?: Record<string, string>): Spec => ({
    name,
    route: `api/${route}`,
    params,
  });
  const result = [
    spec('meta', 'meta'),
    spec('tree.root', 'tree'),
    spec('tree.deep', 'tree', { dir: f.deep }),
    ...[...f.findQueries, 'zzFAAH_NO_MATCH_9c71zz'].map((q, i) => spec(`find.${i}`, 'find', { q })),
    spec('search.common', 'search', { q: 'return' }),
    spec('search.rare', 'search', { q: f.rare }),
    spec('search.regex', 'search', { q: '(function|return|class)\\s+\\w+', re: '1' }),
    spec('search.case-word', 'search', { q: 'return', case: '1', word: '1' }),
    spec('search.no-hit', 'search', { q: 'zzFAAH_NO_MATCH_9c71zz' }),
    spec('file.large', 'file', { path: f.large, start: '0', count: '1000' }),
    spec('file.typical', 'file', { path: f.typical, start: '0', count: '1000' }),
    spec('file.scroll', 'file', {
      path: f.large,
      start: String(Math.floor(f.largeLines * 0.7)),
      count: '1000',
    }),
    spec('markdown', 'markdown', { path: f.readme }),
    spec('outline', 'outline', { path: f.typical }),
    spec('def', 'def', { sym: f.symbol }),
    spec('git.refresh', 'git/refresh'),
    spec('diff', 'diff', { path: f.modified }),
    spec('gutter', 'gutter', { path: f.modified }),
  ];
  if (f.csv) result.push(spec('table', 'table', { path: f.csv }));
  return result;
}
export async function modify(dir: string, f: Fixtures): Promise<void> {
  await writeFile(join(dir, f.modified), f.original + '\n// faah benchmark mutation\n');
}
export function workspaceId(value: unknown): string {
  const body = object(value);
  return str(body.id);
}
