import { linePattern, goExpression, checkRepeats } from './compat.ts';
import { quote } from '../text.ts';
export interface SearchOptions {
  query: string;
  regex?: boolean;
  case?: boolean;
  word?: boolean;
  glob?: string;
  maxFiles?: number;
  maxPerFile?: number;
  classifyDefs?: boolean;
}
export function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (c) => c.toLowerCase());
}
export function pattern(options: SearchOptions): string {
  const { query } = options;
  if (options.regex) checkRepeats(query);
  let pat = options.regex ? query : quote(query);
  const asciiLiteral = !options.regex && !options.word && !options.case;
  if (options.word) pat = '\\b(?:' + pat + ')\\b';
  if (!options.case && (options.regex || options.word)) pat = '(?i)' + pat;
  // Go's Perl classes and word boundaries are ASCII; Unicode literals stay Unicode.
  pat = asciiClasses(linePattern(pat));
  // rg uses a bytes regex: disabling Unicode folding preserves non-ASCII bytes.
  return asciiLiteral ? '(?i-u)' + pat : pat;
}
export function regexError(stderr: string, options: SearchOptions): Error {
  const query = options.query;
  let expr = query;
  let reason =
    stderr
      .trim()
      .split('\n')
      .at(-1)
      ?.replace(/^error:\s*/, '') ?? 'invalid expression';
  if (reason.includes('unclosed character class')) reason = 'missing closing ]';
  else if (reason.includes('unclosed group')) {
    reason = 'missing closing )';
    expr = goExpression(options);
  } else if (reason.includes('unopened group')) {
    reason = 'unexpected )';
    expr = goExpression(options);
  } else if (reason.includes('repetition operator missing expression'))
    reason = 'missing argument to repetition operator';
  if (stderr.includes('look-around')) {
    reason = 'invalid or unsupported Perl syntax';
    expr = /\(\?[=!]|\(\?</.exec(query)?.[0] ?? query;
  }
  if (reason.includes('unrecognized escape sequence')) {
    reason = 'invalid escape sequence';
    expr = /\\[A-Za-z]/.exec(query)?.[0] ?? query;
  }
  return new Error('error parsing regexp: ' + reason + ': `' + expr + '`');
}

function asciiClasses(text: string): string {
  let out = '',
    depth = 0;
  const positive: Record<string, string> = { d: '0-9', w: 'A-Za-z0-9_', s: '\\t\\n\\f\\r ' };
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? '';
    if (c !== '\\') {
      if (c === '[') depth++;
      if (c === ']') depth--;
      out += c;
      continue;
    }
    const next = text[++i] ?? '';
    const cls = positive[next.toLowerCase()];
    if (cls)
      out += next === next.toUpperCase() ? '[^' + cls + ']' : depth > 0 ? cls : '[' + cls + ']';
    else if (next === 'b' || next === 'B') out += '(?-u:\\' + next + ')';
    else out += '\\' + next;
  }
  return out;
}
