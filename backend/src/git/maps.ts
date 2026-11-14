// Git paths can be Object.prototype property names, including __proto__.
export function dictionary<T>(): Record<string, T> {
  const values: Record<string, T> = {};
  Object.setPrototypeOf(values, null);
  return values;
}
