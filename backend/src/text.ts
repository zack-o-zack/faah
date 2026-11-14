export function lower(text: string): string {
  return Array.from(text, (c) => (c === 'İ' ? 'i' : c.toLowerCase())).join('');
}
export function compare(a: string, b: string): number {
  return a === b ? 0 : Buffer.compare(Buffer.from(a), Buffer.from(b));
}
export function quote(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

// Go strings.TrimSpace uses Unicode White_Space, which excludes the BOM.
export function trimSpace(text: string): string {
  return text.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
}
// RE2's Perl whitespace class is ASCII. Preserve it in JavaScript regexes too.
export function goPattern(text: string): string {
  let out = '',
    inClass = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? '';
    if (c === '\\') {
      const next = text[++i] ?? '';
      out += next === 's' ? (inClass ? '\\t\\n\\f\\r ' : '[\\t\\n\\f\\r ]') : '\\' + next;
    } else {
      if (c === '[') inClass = true;
      if (c === ']') inClass = false;
      out += c;
    }
  }
  return out;
}
