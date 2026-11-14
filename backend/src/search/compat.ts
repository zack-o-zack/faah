import { quote } from '../text.ts';
import { characterClass, escape } from './classes.ts';
import type { SearchOptions } from './pattern.ts';

// The Go scanner evaluates each line independently; rg treats \A as a file anchor.
export function linePattern(text: string): string {
  let out = '';
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (c === '[') {
      const cls = characterClass(text, i);
      out += cls.text;
      i = cls.end;
    } else if (c === '\\') {
      const next = text[i + 1];
      if (next === 'Q') {
        const end = text.indexOf('\\E', i + 2);
        out += linePattern(quote(text.slice(i + 2, end < 0 ? undefined : end)));
        i = end < 0 ? text.length : end + 2;
      } else if (next && 'AzbB'.includes(next)) {
        out += next === 'A' ? '^' : next === 'z' ? '$' : '\\' + next;
        i += 2;
      } else {
        const escaped = escape(text, i);
        out += escaped.value === 10 ? '[a&&b]' : escaped.text;
        i = escaped.end;
      }
    } else if (c === '(' && /^\(\?P?<([A-Za-z0-9_]+)>/.test(text.slice(i))) {
      const name = /^\(\?P?<([A-Za-z0-9_]+)>/.exec(text.slice(i))?.[0] ?? '';
      out += '(';
      i += name.length;
    } else if (c === '{' && !/^\{(0|[1-9]\d*)(?:,(0|[1-9]\d*)?)?\}/.test(text.slice(i))) {
      // Go treats malformed counted repeats, including leading zeros, literally.
      out += '\\{';
      i++;
    } else {
      out += c === '\n' ? '[a&&b]' : c;
      i++;
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
  let previous = '',
    current = 1,
    maximum = 1;
  const groups: { current: number; maximum: number }[] = [];
  for (let i = 0; i < query.length; i++) {
    const c = query[i];
    if (c === '\\') {
      if (query[i + 1] === 'Q') {
        const end = query.indexOf('\\E', i + 2);
        i = end < 0 ? query.length : end + 1;
      } else i++;
      previous = '';
      current = 1;
      continue;
    }
    if (c === '[') {
      i = characterClass(query, i).end - 1;
      current = 1;
      previous = '';
      continue;
    }
    if (c === '(') {
      const flags = /^\(\?(?:[imsU-]+[:)]|:|P?<[^>]*>)/.exec(query.slice(i))?.[0];
      if (flags?.endsWith(')')) {
        i += flags.length - 1;
        continue;
      }
      groups.push({ current, maximum });
      current = maximum = 1;
      if (flags) i += flags.length - 1;
      previous = '';
      continue;
    }
    if (c === ')') {
      const parent = groups.pop();
      current = Math.max(current, maximum);
      maximum = Math.max(parent?.maximum ?? 1, parent?.current ?? 1);
      previous = '';
      continue;
    }
    if (c === '|') {
      maximum = Math.max(maximum, current);
      current = 1;
      previous = '';
      continue;
    }
    let token = '',
      copies = 1;
    if (c === '*' || c === '+' || c === '?') token = c;
    else if (c === '{') {
      const match = /^\{(0|[1-9]\d*)(?:,(0|[1-9]\d*)?)?\}/.exec(query.slice(i));
      if (match) {
        const min = Number(match[1]);
        const max = match[2] === undefined ? min : Number(match[2]);
        if (min > 1000 || max > 1000 || max < min)
          throw new Error('error parsing regexp: invalid repeat count: `' + match[0] + '`');
        token = match[0];
        copies = max;
      }
    }
    if (!token) {
      maximum = Math.max(maximum, current);
      current = 1;
      previous = '';
      continue;
    }
    i += token.length - 1;
    if (query[i + 1] === '?') {
      token += '?';
      i++;
    }
    if (previous)
      throw new Error(
        'error parsing regexp: invalid nested repetition operator: `' + previous + token + '`',
      );
    if (copies >= 2 && current * copies > 1000)
      throw new Error('error parsing regexp: invalid repeat count: `' + token + '`');
    current *= copies;
    previous = token;
  }
}
