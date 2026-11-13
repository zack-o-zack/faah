export function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('Expected a fixture value');
  return value;
}
