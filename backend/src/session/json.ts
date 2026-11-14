/** Preserve Go's int64 JSON digits even outside JavaScript's exact integer range. */
export function sessionJSON(value: unknown): string {
  return JSON.stringify(value, (_key, field: unknown) =>
    typeof field === 'bigint' ? JSON.rawJSON(field.toString()) : field,
  );
}
// Bun provides rawJSON; the bundled TypeScript library does not declare it yet.
declare global {
  interface JSON {
    rawJSON(text: string): unknown;
  }
}
