/** RE2's Perl `\s` class is ASCII-only; rewrite it so a JavaScript regex matches the same set. */
export function re2Pattern(text: string): string {
  let out = '',
    inClass = false;
  for (let i = 0; i < text.length; i++) {
    const character = text[i] ?? '';
    if (character === '\\') {
      const next = text[++i] ?? '';
      out += next === 's' ? (inClass ? '\\t\\n\\f\\r ' : '[\\t\\n\\f\\r ]') : '\\' + next;
    } else {
      if (character === '[') inClass = true;
      if (character === ']') inClass = false;
      out += character;
    }
  }
  return out;
}
