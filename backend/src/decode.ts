export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function string(value: unknown, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw new Error('expected string');
  return value;
}
export function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('expected number');
  return value;
}
export function record(value: unknown): Record<string, unknown> {
  if (!object(value)) throw new Error('expected object');
  return value;
}
export function parse(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  return record(value);
}
export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
