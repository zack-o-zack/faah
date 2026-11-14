import { lstat, open, readFile } from 'node:fs/promises';
import { join, extname, posix } from 'node:path';
import { compilePattern } from '../ignore/service.ts';
import { newItem, type Item } from '../fuzzy/score.ts';
import { declPatterns } from '../symbols/service.ts';
import { compare, trimSpace, lower } from '../text.ts';
import { pattern, regexError, asciiLower, type SearchOptions } from './pattern.ts';
import { runRG, type RGMatch } from './rg.ts';
import { walkGlobs, type Excluded } from './walk.ts';
import { nullable } from './compat.ts';
import { finishNullable } from './empty.ts';
import { snip, type Snippet } from './snip.ts';
export interface Match extends Snippet {
  line: number;
  def?: boolean;
}
export interface FileMatches {
  path: string;
  matches: Match[];
}
export async function unindexedTarget(
  root: string,
  files: Item[],
  glob: string,
): Promise<Item | undefined> {
  const rel = glob.replace(/^\//, '');
  if (
    !rel ||
    /[*?[!\\]/.test(rel) ||
    rel.endsWith('/') ||
    rel.split('/').some((s) => !s || s === '.' || s === '..') ||
    files.some((f) => f.path === rel)
  )
    return;
  try {
    const info = await lstat(join(root, rel));
    if (info.isFile()) return newItem(rel, info.size);
  } catch {
    return;
  }
}
export class Search {
  constructor(
    readonly options: {
      root: string;
      files: () => Item[];
      strategy?: 'explicit' | 'walk';
      excluded?: () => Excluded[];
    },
  ) {}
  async search(
    opts: SearchOptions,
    signal: AbortSignal,
  ): Promise<{ results: FileMatches[]; truncated: boolean }> {
    if (!trimSpace(opts.query)) return { results: [], truncated: false };
    signal.throwIfAborted();
    const expression = pattern(opts);
    const empty = opts.regex
      ? (nullable(expression) ?? (await this.emptyMatch(expression, signal)))
      : false;
    const maxFiles = opts.maxFiles || 200,
      maxPerFile = opts.maxPerFile || 50;
    const extra = await unindexedTarget(this.options.root, this.options.files(), opts.glob ?? '');
    const glob = compilePattern(opts.glob ?? '');
    const files = (extra ? [extra] : this.options.files()).filter(
      (f) => f.size > 0 && f.size <= 8 * 1024 * 1024 && (!glob || glob.hit(f.path, false)),
    );
    const allowed = new Set(files.map((f) => f.path));
    const valid = new Map<string, boolean>();
    const results = new Map<string, Match[]>();
    const completed = new Set<string>();
    const stopped = new AbortController();
    const runSignal = AbortSignal.any([signal, stopped.signal]);
    const complete = (rawPath: string) => {
      if (stopped.signal.aborted) return;
      const path = rawPath.replace(/^\.\//, '');
      if (results.has(path)) completed.add(path);
      if (completed.size >= maxFiles) stopped.abort();
    };
    const defs = opts.classifyDefs ? declPatterns(opts.query) : undefined;
    const accept = async (hit: RGMatch) => {
      if (stopped.signal.aborted) return;
      const path = hit.path.replace(/^\.\//, '');
      if (!allowed.has(path)) return;
      let matches = results.get(path);
      if (matches && matches.length >= maxPerFile) return;
      if (!valid.has(path)) {
        const file = await open(join(this.options.root, path)).catch(() => undefined);
        if (!file) {
          valid.set(path, false);
          return;
        }
        try {
          const buffer = Buffer.alloc(8000);
          const { bytesRead } = await file.read(buffer, 0, 8000, 0);
          let okay = !buffer.subarray(0, bytesRead).includes(0);
          if (okay && opts.word && !opts.regex && !opts.case) {
            const data = await readFile(join(this.options.root, path));
            okay = asciiLower(data.toString()).includes(asciiLower(opts.query));
          }
          valid.set(path, okay);
        } finally {
          await file.close();
        }
      }
      if (!valid.get(path)) return;
      matches ??= [];
      const bytes = Buffer.from(hit.line);
      const line = bytes.subarray(0, bytes.at(-1) === 10 ? bytes.length - 1 : bytes.length);
      const declaration = defs?.get(extname(path).toLowerCase())?.test(line.toString()) ?? false;
      for (const match of hit.matches) {
        if (matches.length >= maxPerFile) break;
        // RE2 advances empty matches by a rune, including when rg reports byte positions.
        if (match.start === match.end && ((line[match.start] ?? 0) & 0xc0) === 0x80) continue;
        matches.push({
          ...snip({ line, from: match.start, to: match.end }),
          line: hit.lineNumber,
          ...(declaration ? { def: true } : {}),
        });
      }
      if (matches.length) results.set(path, matches);
    };
    const args = [
      '--json',
      '--text',
      '--hidden',
      '--no-ignore',
      '--no-config',
      '--threads',
      '1',
      '--max-count',
      String(maxPerFile),
      '-e',
      expression,
      '--',
    ];
    let batches: string[][] = [];
    const strategy = this.options.strategy ?? (files.length >= 4000 ? 'walk' : 'explicit');
    const globs =
      strategy === 'walk' && !extra && files.every((f) => f.walked)
        ? walkGlobs({
            files,
            source: this.options.files(),
            excluded: this.options.excluded?.() ?? [],
          })
        : undefined;
    if (globs) {
      args.splice(args.length - 1, 0, ...globs);
      batches = [['.']];
    } else {
      let batch: string[] = [],
        size = 0;
      for (const file of files) {
        const length = Buffer.byteLength(file.path) + 1;
        if (size + length > 128000 && batch.length) {
          batches.push(batch);
          batch = [];
          size = 0;
        }
        batch.push('./' + file.path);
        size += length + 2;
      }
      if (batch.length) batches.push(batch);
    }
    if (!batches.length) batches = [['-']];
    // Bound process concurrency while keeping the event loop available for HTTP.
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, batches.length) }, async () => {
        while (next < batches.length && !stopped.signal.aborted) {
          const batch = batches[next++];
          if (!batch) return;
          const result = await runRG({
            root: this.options.root,
            args: [...args, ...batch],
            signal: runSignal,
            match: accept,
            complete,
          });
          if (result.code > 1 && !runSignal.aborted && result.stderr.includes('regex parse error'))
            throw regexError(result.stderr, opts);
          signal.throwIfAborted();
        }
      }),
    );
    for (const path of results.keys()) if (!completed.has(path)) results.delete(path);
    if (empty)
      await finishNullable({
        root: this.options.root,
        files,
        results,
        maxFiles,
        maxPerFile,
        signal,
      });
    const out = [...results.entries()]
      .map(([path, matches]) => ({ path, matches }))
      .sort((a, b) => compare(a.path, b.path));
    return { results: out.slice(0, maxFiles), truncated: out.length > maxFiles };
  }
  private async emptyMatch(expression: string, signal: AbortSignal): Promise<boolean> {
    let empty = false;
    await runRG({
      root: this.options.root,
      args: ['--json', '--text', '-e', expression, '--', '-'],
      signal,
      input: '\n',
      match: async (hit) => {
        empty = hit.matches.some((m) => m.start === m.end);
      },
    });
    return empty;
  }
  async definitions(symbol: string, signal: AbortSignal) {
    const { results } = await this.search(
      { query: symbol, word: true, case: true, maxFiles: 400, maxPerFile: 20, classifyDefs: true },
      signal,
    );
    const defs: (Match & { path: string })[] = [],
      seen = new Set<string>();
    let refCount = 0;
    for (const file of results)
      for (const match of file.matches) {
        if (!match.def) {
          refCount++;
          continue;
        }
        const key = file.path + ':' + match.line;
        if (seen.has(key)) continue;
        seen.add(key);
        defs.push({ path: file.path, ...match });
      }
    defs.sort(
      (a, b) =>
        Number(lower(posix.basename(b.path)).includes(lower(symbol))) -
        Number(lower(posix.basename(a.path)).includes(lower(symbol))),
    );
    return { symbol, defs, refCount };
  }
}
