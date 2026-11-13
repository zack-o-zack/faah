export const DEFAULT_LAYOUT = {
  left: true,
  right: false,
  threads: false,
  leftWidth: 340,
  rightWidth: 384,
  threadsWidth: 384,
  inspector: 'refs',
};
export function readLayout(value) {
  let parsed;
  try {
    parsed = JSON.parse(value || '{}');
  } catch {
    parsed = {};
  }
  const result = { ...DEFAULT_LAYOUT };
  for (const key of ['left', 'right', 'threads'])
    if (typeof parsed[key] === 'boolean') result[key] = parsed[key];
  for (const [key, min, max] of [
    ['leftWidth', 170, 620],
    ['rightWidth', 200, 700],
    ['threadsWidth', 240, 900],
  ])
    if (Number.isFinite(parsed[key])) result[key] = Math.max(min, Math.min(max, parsed[key]));
  if (['refs', 'symbols', 'calls', 'search', 'tips'].includes(parsed.inspector))
    result.inspector = parsed.inspector;
  return result;
}
