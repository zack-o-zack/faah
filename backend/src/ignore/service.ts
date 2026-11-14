import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { quote, trimSpace } from '../text.ts';
export const defaultIgnores = [
  '.git/',
  '.hg/',
  '.svn/',
  'node_modules/',
  '.venv/',
  'venv/',
  '__pycache__/',
  'target/',
  'dist/',
  'build/',
  '.next/',
  '.nuxt/',
  'vendor/',
  '.idea/',
  '.vscode/',
  '.mypy_cache/',
  '.pytest_cache/',
  '.ruff_cache/',
  '.gradle/',
  '.tox/',
  '*.pyc',
  '*.class',
  '*.o',
  '*.so',
  '*.dylib',
  '*.a',
  '*.exe',
  '*.pdb',
  '.DS_Store',
  '*.lock',
];
export interface Rule {
  negate: boolean;
  dirOnly: boolean;
  hit(rel: string, isDir: boolean): boolean;
  kind: string;
}
export function compilePattern(pattern: string, fast = true): Rule | undefined {
  let p = pattern.replace(/ +$/, '');
  if (!p || p.startsWith('#')) return;
  const negate = p.startsWith('!');
  if (negate) p = p.slice(1);
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.slice(0, -1);
  const anchored = p.replace(/\/$/, '').includes('/');
  p = p.replace(/^\//, '');
  let kind = 'regex';
  if (fast) {
    if (!/[*?]/.test(p)) kind = anchored ? 'path' : 'segment';
    else if (!anchored && p.startsWith('*') && !/[*?]/.test(p.slice(1))) kind = 'suffix';
  }
  if (kind === 'path') {
    const literal = p;
    return {
      kind,
      negate,
      dirOnly,
      hit: (rel, isDir) => (rel === literal ? !dirOnly || isDir : rel.startsWith(literal + '/')),
    };
  }
  if (kind === 'segment' || kind === 'suffix') {
    const literal = kind === 'suffix' ? p.slice(1) : p;
    const length = literal.length,
      suffix = kind === 'suffix';
    return {
      kind,
      negate,
      dirOnly,
      hit: (rel, isDir) => {
        let index = rel.indexOf(literal);
        while (index >= 0) {
          const end = index + length;
          if (
            (suffix || index === 0 || rel.charCodeAt(index - 1) === 47) &&
            (end === rel.length || rel.charCodeAt(end) === 47) &&
            (end < rel.length || !dirOnly || isDir)
          )
            return true;
          if (index === rel.length) break;
          index = rel.indexOf(literal, index + 1);
        }
        return false;
      },
    };
  }
  const prefix = fast && anchored ? (p.split(/[*?]/)[0] ?? '') : '';
  const must = fast
    ? p
        .split(/[*?]+/)
        .map((v) => v.replace(/^\//, ''))
        .reduce((a, b) => (Buffer.byteLength(a) >= Buffer.byteLength(b) ? a : b), '')
    : '';
  let body = anchored ? '^' : '^(?:[^\\n]*/)?';
  const bytes = Buffer.from(p);
  for (let i = 0; i < bytes.length; i++) {
    const c = String.fromCharCode(bytes[i] ?? 0);
    if (c === '*') {
      if (bytes[i + 1] === 42) {
        if (bytes[i + 2] === 47) {
          body += '(?:[^\\n]*/)?';
          i += 2;
        } else {
          body += '[^\\n]*';
          i++;
        }
      } else body += '[^/]*';
    } else if (c === '?') body += '[^/]';
    else body += quote(c);
  }
  const re = new RegExp(body + '(?![\\s\\S])', 'u'),
    sub = new RegExp(body + '/[^\\n]*(?![\\s\\S])', 'u');
  return {
    kind,
    negate,
    dirOnly,
    hit: (rel, isDir) =>
      (!prefix || rel.startsWith(prefix)) &&
      (!must || rel.includes(must)) &&
      ((re.test(rel) && (!dirOnly || isDir)) || sub.test(rel)),
  };
}
export class IgnoreSet {
  readonly rules: Rule[];
  constructor(extra: string[] = [], inherit?: Rule[]) {
    this.rules = inherit
      ? [...inherit]
      : defaultIgnores.flatMap((p) => {
          const r = compilePattern(p);
          return r ? [r] : [];
        });
    for (const p of extra) {
      const r = compilePattern(p);
      if (r) this.rules.push(r);
    }
  }
  child(patterns: string[]): IgnoreSet {
    return patterns.length ? new IgnoreSet(patterns, this.rules) : this;
  }
  match(rel: string, isDir: boolean): boolean {
    for (let i = this.rules.length - 1; i >= 0; i--) {
      const rule = this.rules[i];
      if (rule?.hit(rel, isDir)) return !rule.negate;
    }
    return false;
  }
}
export async function readGitignore(dir: string, relDir: string): Promise<string[]> {
  try {
    const text = await readFile(join(dir, '.gitignore'), 'utf8');
    const lines = text.split('\n');
    const out: string[] = [];
    for (const raw of lines) {
      if (Buffer.byteLength(raw) >= 65536) break;
      const line = trimSpace(raw);
      if (!line || line.startsWith('#')) continue;
      if (!relDir) out.push(line);
      else
        out.push(
          (line.startsWith('!') ? '!' : '') +
            relDir +
            '/' +
            line.replace(/^!/, '').replace(/^\//, ''),
        );
    }
    return out;
  } catch {
    return [];
  }
}
