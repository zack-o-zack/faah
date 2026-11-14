// Parse Go class atoms before Rust can interpret nested sets or class subtraction.
interface Atom {
  text: string;
  end: number;
  value?: number;
}
function rune(value: number, end: number): Atom {
  return { text: '\\x{' + value.toString(16) + '}', value, end };
}
export function escape(text: string, start: number): Atom {
  const next = text[start + 1] ?? '';
  if (!next) throw new Error('error parsing regexp: trailing backslash at end of expression: ``');
  const octal = /^[0-7]{1,3}/.exec(text.slice(start + 1))?.[0];
  if (octal && (octal.length > 1 || next === '0'))
    return rune(parseInt(octal, 8), start + 1 + octal.length);
  const hex = /^x(?:\{([0-9a-fA-F]+)\}|([0-9a-fA-F]{2}))/.exec(text.slice(start + 1));
  if (hex) return rune(parseInt(hex[1] ?? hex[2] ?? '', 16), start + 1 + hex[0].length);
  const controls: Record<string, number> = { a: 7, f: 12, n: 10, r: 13, t: 9, v: 11 };
  const control = controls[next];
  if (control !== undefined) return rune(control, start + 2);
  if (next && !/[A-Za-z0-9]/.test(next)) return rune(next.codePointAt(0) ?? 0, start + 2);
  const group = /^[pP](?:\{[^}]*\}|.)/.exec(text.slice(start + 1))?.[0];
  if (group) return { text: '\\' + group, end: start + 1 + group.length };
  if (/[dDsSwW]/.test(next)) return { text: '\\' + next, end: start + 2 };
  throw new Error(
    'error parsing regexp: invalid escape sequence: `' + text.slice(start, start + 2) + '`',
  );
}
function atom(text: string, start: number): Atom {
  if (text[start] === '\\') return escape(text, start);
  const named = /^\[:[^\]]*:\]/.exec(text.slice(start))?.[0];
  if (named) return { text: named, end: start + named.length };
  const value = text.codePointAt(start);
  if (value === undefined)
    throw new Error('error parsing regexp: missing closing ]: `' + text + '`');
  return rune(value, start + (value > 0xffff ? 2 : 1));
}
export function characterClass(text: string, start: number): { text: string; end: number } {
  const negated = text[start + 1] === '^';
  let i = start + (negated ? 2 : 1),
    out = negated ? '[^' : '[';
  let first = true;
  while (i < text.length && (text[i] !== ']' || first)) {
    first = false;
    const from = i,
      lo = atom(text, i);
    i = lo.end;
    if (lo.value !== undefined && text[i] === '-' && text[i + 1] !== ']') {
      const hi = atom(text, i + 1);
      i = hi.end;
      if (hi.value === undefined || hi.value < lo.value)
        throw new Error(
          'error parsing regexp: invalid character class range: `' + text.slice(from, i) + '`',
        );
      out += lo.text + '-' + hi.text;
    } else out += lo.text;
  }
  if (text[i] !== ']')
    throw new Error('error parsing regexp: missing closing ]: `' + text.slice(start) + '`');
  return { text: out + ']', end: i + 1 };
}
