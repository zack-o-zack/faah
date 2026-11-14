import { basename } from 'node:path';
import lexers from './lexers.json';
import { trimSpace } from '../text.ts';
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
    const c = pattern[i] ?? '';
    if (c === '*') result += '.*';
    else if (c === '?') result += '.';
    else if (c === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end < 0) throw new Error('invalid lexer filename');
      result += pattern.slice(i, end + 1);
      i = end;
    } else if (c === '\\') result += '\\' + (pattern[++i] ?? '');
    else result += c.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }
  return new RegExp(result + '$', 'u');
}
const ordered = lexers
  .map((lexer, order) => ({
    ...lexer,
    order,
    primary: lexer.filenames.flatMap((p) => suffixes.map((s) => glob(p + s))),
    fallback: lexer.secondary.flatMap((p) => suffixes.map((s) => glob(p + s))),
  }))
  .sort((a, b) => b.priority - a.priority || a.order - b.order);
export function filenameLanguage(path: string): string | undefined {
  const name = basename(path);
  return (
    ordered.find((l) => l.primary.some((p) => p.test(name)))?.name ??
    ordered.find((l) => l.fallback.some((p) => p.test(name)))?.name
  );
}
export function fenceLanguage(alias: string): string | undefined {
  return (
    lexers.find(
      (l) =>
        l.name.toLowerCase() === alias.toLowerCase() ||
        l.aliases.some((a) => a.toLowerCase() === alias.toLowerCase()),
    )?.name ??
    filenameLanguage(alias) ??
    filenameLanguage('file.' + alias)
  );
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
      const d = source.includes('definition '),
        r = source.includes('relation '),
        p = source.includes('permission ');
      value = d && r && p ? 0.9 : d || r ? 0.5 : p ? 0.25 : 0;
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
    Array.from(trimSpace(text), (c) =>
      /[\p{L}\p{N}_-]/u.test(c) ? (c === 'İ' ? 'i' : c.toLowerCase()) : c === ' ' ? '-' : '',
    ).join('') || 'section';
  const base = id;
  for (let i = 1; seen.has(id); i++) id = base + '-' + i;
  seen.add(id);
  return id;
}
