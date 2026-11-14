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
  let text = pattern.replace(/ +$/, '');
  if (!text || text.startsWith('#')) return;
  const negate = text.startsWith('!');
  if (negate) text = text.slice(1);
  const dirOnly = text.endsWith('/');
  if (dirOnly) text = text.slice(0, -1);
  const anchored = text.replace(/\/$/, '').includes('/');
  text = text.replace(/^\//, '');
  let kind = 'regex';
  if (fast) {
    if (!/[*?]/.test(text)) kind = anchored ? 'path' : 'segment';
    else if (!anchored && text.startsWith('*') && !/[*?]/.test(text.slice(1))) kind = 'suffix';
  }
  if (kind === 'path') {
    const literal = text;
    return {
      kind,
      negate,
      dirOnly,
      hit: (rel, isDir) => (rel === literal ? !dirOnly || isDir : rel.startsWith(literal + '/')),
    };
  }
  if (kind === 'segment' || kind === 'suffix') {
    const literal = kind === 'suffix' ? text.slice(1) : text;
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
  const prefix = fast && anchored ? (text.split(/[*?]/)[0] ?? '') : '';
  const must = fast
    ? text
        .split(/[*?]+/)
        .map((segment) => segment.replace(/^\//, ''))
        .reduce((a, b) => (Buffer.byteLength(a) >= Buffer.byteLength(b) ? a : b), '')
    : '';
  let body = anchored ? '^' : '^(?:[^\\n]*/)?';
  const bytes = Buffer.from(text);
  for (let i = 0; i < bytes.length; i++) {
    const character = String.fromCharCode(bytes[i] ?? 0);
    if (character === '*') {
      if (bytes[i + 1] === 42) {
        if (bytes[i + 2] === 47) {
          body += '(?:[^\\n]*/)?';
          i += 2;
        } else {
          body += '[^\\n]*';
          i++;
        }
      } else body += '[^/]*';
    } else if (character === '?') body += '[^/]';
    else body += quote(character);
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
      : defaultIgnores.flatMap((pattern) => {
          const rule = compilePattern(pattern);
          return rule ? [rule] : [];
        });
    for (const pattern of extra) {
      const rule = compilePattern(pattern);
      if (rule) this.rules.push(rule);
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
