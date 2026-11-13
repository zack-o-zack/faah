/** Match the URL parser's handling of embedded tab/newline and edge control bytes. */
export function normalizeURL(reference: string): string {
  const value = reference.replace(/[\t\r\n]/g, '');
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) <= 32) start++;
  while (end > start && value.charCodeAt(end - 1) <= 32) end--;
  return value.slice(start, end);
}
