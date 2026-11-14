import { quote } from '../text.ts';
import type { SearchOptions } from './pattern.ts';

// The Go scanner evaluates each line independently; rg treats \A as a file anchor.
export function linePattern(text: string): string {
  let out = '',
    inClass = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? '';
    if (c === '\\') {
      const next = text[++i] ?? '';
      if (next === 'Q') {
        const end = text.indexOf('\\E', i + 1);
        out += linePattern(quote(text.slice(i + 1, end < 0 ? undefined : end)));
        i = end < 0 ? text.length : end + 1;
      } else if (!inClass && (next === 'A' || next === 'z')) out += next === 'A' ? '^' : '$';
      else if (!inClass && next === 'n') out += '[a&&b]';
      else out += '\\' + next;
    } else {
      if (c === '[') inClass = true;
      if (c === ']') inClass = false;
      out += c === '\n' && !inClass ? '[a&&b]' : c;
    }
  }
  return out;
}

export function nullable(pattern: string): boolean | undefined {
  // Flags and greediness do not affect whether the empty string is accepted.
  const js = pattern
    .replace(/\(\?[imsU-]+\)/g, '')
    .replace(/\(\?[imsU-]+:/g, '(?:')
    .replaceAll('(?-u:\\b)', '\\b')
    .replaceAll('(?-u:\\B)', '\\B')
    .replaceAll('(?P<', '(?<');
  try {
    return new RegExp(js, 'u').test('');
  } catch {
    return undefined;
  }
}

export function goExpression(options: SearchOptions): string {
  let expr = options.regex ? options.query : quote(options.query);
  if (options.word) expr = '\\b(?:' + expr + ')\\b';
  return options.case ? expr : '(?i)' + expr;
}

export function checkRepeats(query: string): void {
  // RE2 caps counted repetitions at 1000; Rust's engine has a higher limit.
  let inClass = false;
  for (let i = 0; i < query.length; i++) {
    const c = query[i];
    if (c === '\\') {
      if (query[i + 1] === 'Q') {
        const end = query.indexOf('\\E', i + 2);
        i = end < 0 ? query.length : end + 1;
      } else i++;
      continue;
    }
    if (c === '[') inClass = true;
    if (c === ']') inClass = false;
    if (c !== '{' || inClass) continue;
    const match = /^\{(\d+)(?:,(\d*))?\}/.exec(query.slice(i));
    if (!match) continue;
    const min = Number(match[1]),
      max = match[2] ? Number(match[2]) : undefined;
    if (min > 1000 || (max !== undefined && (max > 1000 || max < min)))
      throw new Error('error parsing regexp: invalid repeat count: `' + match[0] + '`');
  }
}
