// String semantics of Go's standard library, where JavaScript differs.

/** Go strings.ToLower: U+0130 lowers to a plain `i`, not `i` plus a combining dot. */
export function lower(text: string): string {
  return Array.from(text, (character) => (character === 'İ' ? 'i' : character.toLowerCase())).join(
    '',
  );
}

/** Go string ordering compares UTF-8 bytes, not UTF-16 code units. */
export function compare(a: string, b: string): number {
  return a === b ? 0 : Buffer.compare(Buffer.from(a), Buffer.from(b));
}

/** Go regexp.QuoteMeta for the metacharacters both regex dialects share. */
export function quoteMeta(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

/** Go strings.TrimSpace uses Unicode White_Space, which excludes the BOM. */
export function trimSpace(text: string): string {
  return text.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
}
