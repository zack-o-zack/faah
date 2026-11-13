export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Expected an object');
  return value;
}
export function text(value: unknown, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw new Error('Expected text');
  return value;
}
export function number(value: unknown, fallback = 0): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Expected a number');
  return value;
}
export function boolean(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new Error('Expected a boolean');
  return value;
}
export function list(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('Expected an array');
  return value;
}
export function strings(value: unknown): string[] {
  return list(value).map((item) => text(item));
}
export function stringMap(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value == null ? {} : record(value)).map(([key, item]) => [key, text(item)]),
  );
}
export function booleanMap(value: unknown): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(value == null ? {} : record(value)).map(([key, item]) => [key, boolean(item)]),
  );
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
