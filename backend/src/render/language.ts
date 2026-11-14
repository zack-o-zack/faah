import { basename } from 'node:path';
import lexers from './lexers.json';
import { trimSpace } from '../compat/go-strings.ts';
// Configs exported, in registry order, from pinned Chroma v2.27.0. Filename
// matching is case-sensitive even for lexers whose token rules ignore case.
const suffixes = [
  '',
  '~',
  '.bak',
  '.old',
  '.orig',
  '.dpkg-dist',
  '.dpkg-old',
  '.ucf-dist',
  '.ucf-new',
  '.ucf-old',
  '.rpmnew',
  '.rpmorig',
  '.rpmsave',
  '.in',
];

function glob(pattern: string): RegExp {
  let result = '^';
  for (let i = 0; i < pattern.length; i++) {
    const character = pattern[i] ?? '';
    if (character === '*') result += '.*';
    else if (character === '?') result += '.';
    else if (character === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end < 0) throw new Error('invalid lexer filename');
      result += pattern.slice(i, end + 1);
      i = end;
    } else if (character === '\\') result += '\\' + (pattern[++i] ?? '');
    else result += character.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }
  return new RegExp(result + '$', 'u');
}

const ordered = lexers
  .map((lexer, order) => ({
    ...lexer,
    order,
    primary: lexer.filenames.map(glob),
    fallback: lexer.secondary.map(glob),
  }))
  .sort((a, b) => b.priority - a.priority || a.order - b.order);
const filenameCache = new Map<string, (typeof ordered)[number] | undefined>();

function filenameLexer(path: string) {
  const name = basename(path);
  if (filenameCache.has(name)) return filenameCache.get(name);
  const names = [
    name,
    ...suffixes
      .filter((suffix) => suffix && name.endsWith(suffix))
      .map((suffix) => name.slice(0, -suffix.length)),
  ];
  const lexer =
    ordered.find((candidate) =>
      candidate.primary.some((pattern) => names.some((n) => pattern.test(n))),
    ) ??
    ordered.find((candidate) =>
      candidate.fallback.some((pattern) => names.some((n) => pattern.test(n))),
    );
  if (filenameCache.size >= 4096) filenameCache.clear();
  if (name.length <= 512) filenameCache.set(name, lexer);
  return lexer;
}

export function filenameLanguage(path: string): string | undefined {
  return filenameLexer(path)?.name;
}
const byName = new Map<string, string>(),
  byAlias = new Map<string, string>();
for (const lexer of lexers) {
  byName.set(lexer.name, lexer.name);
  byName.set(lexer.name.toLowerCase(), lexer.name);
  for (const alias of lexer.aliases) {
    byAlias.set(alias, lexer.name);
    byAlias.set(alias.toLowerCase(), lexer.name);
  }
}

export function fenceLanguage(alias: string): string | undefined {
  const exact =
    byName.get(alias) ??
    byAlias.get(alias) ??
    byName.get(alias.toLowerCase()) ??
    byAlias.get(alias.toLowerCase());
  if (exact) return exact;
  const extension = filenameLexer('filename.' + alias),
    file = filenameLexer(alias);
  return extension && (!file || extension.priority >= file.priority) ? extension.name : file?.name;
}

function analyse(source: string): string | undefined {
  let best: string | undefined,
    score = 0;
  for (const lexer of lexers) {
    let value = 0;
    const rules = lexer.analyse;
    if (rules)
      for (const rule of rules.Regexes) {
        const multiline = rule.Pattern.startsWith('(?m)');
        if (
          new RegExp(
            multiline ? rule.Pattern.slice(4) : rule.Pattern,
            (multiline ? 'm' : '') + (lexer.ignoreCase ? 'i' : ''),
          ).test(source)
        ) {
          value = Math.fround(value + Math.fround(rule.Score));
          if (rules.First) break;
        }
      }
    if (lexer.name === 'Go')
      value = source.includes('package ') ? (source.includes('fmt.') ? 0.5 : 0.1) : 0;
    if (lexer.name === 'dns' && /^@\s+IN\s+SOA\s+/m.test(source)) value = 1;
    if (lexer.name === 'MySQL') {
      const ticks = source.match(/`[a-zA-Z_]\w*`/g)?.length ?? 0;
      const brackets = source.match(/\[[a-zA-Z_]\w*\]/g)?.length ?? 0;
      value =
        ticks + brackets >= 1 && ticks >= 2 * brackets
          ? 0.5
          : ticks > brackets
            ? 0.2
            : ticks > 0
              ? 0.1
              : 0;
    }
    if (lexer.name === 'Zed') {
      const definitions = source.includes('definition '),
        relations = source.includes('relation '),
        permissions = source.includes('permission ');
      value =
        definitions && relations && permissions
          ? 0.9
          : definitions || relations
            ? 0.5
            : permissions
              ? 0.25
              : 0;
    }
    value = Math.fround(Math.min(value, 1));
    if (value > score) {
      score = value;
      best = lexer.name;
    }
  }
  return best;
}

export function language(path: string, source: string): string {
  return (
    filenameLanguage(path) ??
    analyse(Buffer.from(source).subarray(0, 4096).toString()) ??
    'plain text'
  );
}

export function headingID(text: string, seen: Set<string>): string {
  let id =
    Array.from(trimSpace(text), (character) =>
      /[\p{L}\p{N}_-]/u.test(character)
        ? character === 'İ'
          ? 'i'
          : character.toLowerCase()
        : character === ' '
          ? '-'
          : '',
    ).join('') || 'section';
  const base = id;
  for (let i = 1; seen.has(id); i++) id = base + '-' + i;
  seen.add(id);
  return id;
}
