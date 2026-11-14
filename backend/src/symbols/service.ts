import patterns from './patterns.json';
import { extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { quote, goPattern } from '../text.ts';
const extensions: Record<string, string> = patterns.extensions;
const templates: Record<string, string> = patterns.decls;
const rules: Record<string, { kind: string; pattern: string }[]> = patterns.outline;
export interface Symbol {
  name: string;
  kind: string;
  line: number;
  indent: number;
}
export const identRe = /^[A-Za-z_$][\w$]*(?![\s\S])/;
export function familyFor(ext: string): string {
  return extensions[ext] ?? '';
}
export function compileDeclFamily(family: string, query: string): RegExp | undefined {
  const template = templates[family];
  if (!template) return;
  try {
    return new RegExp(goPattern(template.replaceAll('NAME', query)));
  } catch {
    return;
  }
}
export function declPatterns(ident: string): Map<string, RegExp> | undefined {
  if (!identRe.test(ident)) return;
  const byFamily = new Map<string, RegExp>();
  for (const family of Object.keys(templates)) {
    const re = compileDeclFamily(family, quote(ident));
    if (re) byFamily.set(family, re);
  }
  const out = new Map<string, RegExp>();
  for (const [ext, family] of Object.entries(extensions)) {
    const re = byFamily.get(family);
    if (re) out.set(ext, re);
  }
  return out;
}
export function indentCols(text: string): number {
  let cols = 0;
  for (const c of text) cols += c === '\t' ? 4 : 1;
  return Math.floor(cols / 2);
}
const compiled = Object.fromEntries(
  Object.entries(rules).map(([family, rules]) => [
    family,
    rules.map((r) => ({ kind: r.kind, re: new RegExp(goPattern(r.pattern)) })),
  ]),
);
export function outlineText(text: string, rel: string): Symbol[] {
  const ext = extname(rel).toLowerCase();
  const md = ext === '.md' || ext === '.markdown';
  const rules = compiled[familyFor(ext)] ?? [];
  const out: Symbol[] = [];
  for (const [index, line] of text.split('\n').entries()) {
    if (Buffer.byteLength(line) >= 256 * 1024) break;
    const text = line.replace(/\r$/, '');
    if (md) {
      const m = /^(#{1,6})[\t\f\r ]+(.+?)[\t\f\r ]*#*[\t\f\r ]*$/.exec(text);
      if (m?.[1] && m[2])
        out.push({ name: m[2], kind: 'heading', line: index + 1, indent: m[1].length - 1 });
      continue;
    }
    for (const rule of rules) {
      const m = rule.re.exec(text);
      if (!m) continue;
      const name = m.at(-1) || m.at(-2) || '';
      const indent = m.length >= 3 ? indentCols(m[1] ?? '') : 0;
      out.push({
        name,
        kind: indent > 0 && ['func', 'def', 'fn'].includes(rule.kind) ? 'method' : rule.kind,
        line: index + 1,
        indent,
      });
      break;
    }
  }
  return out;
}
export async function outline(abs: string, rel: string): Promise<Symbol[]> {
  try {
    return outlineText(await readFile(abs, 'utf8'), rel);
  } catch (error) {
    // Go opens directories successfully and ignores the scanner's read error.
    if (error instanceof Error && 'code' in error && error.code === 'EISDIR') return [];
    throw error;
  }
}
