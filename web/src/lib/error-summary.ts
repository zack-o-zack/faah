export function errorSummary(text = ''): string {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const said = lines
    .filter((line) => /^(error|fatal)\b/i.test(line))
    .map((line) => line.replace(/^(error|fatal)\b\s*:?\s*/i, ''));
  return [...new Set(said)].join('\n') || lines.at(-1) || '';
}
export function fullError(text = '', streams: (string | undefined)[][] = []): string {
  return [
    text.trim(),
    ...streams.filter((stream) => stream[1]).map((stream) => `${stream[0]}:\n${stream[1]?.trim()}`),
  ]
    .filter(Boolean)
    .join('\n\n');
}
