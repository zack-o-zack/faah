// Nearest-rank p95 (including observed tails); median interpolates the middle pair.
export function median(values) {
  const sorted = finiteSorted(values);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function finiteSorted(values) {
  return values.filter(Number.isFinite).sort((a, b) => a - b);
}
export function percentile(values, fraction = 0.95) {
  if (fraction < 0 || fraction > 1) throw new RangeError('Percentile must be between 0 and 1');
  const sorted = finiteSorted(values);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
}
export function summarize(values) {
  return { count: values.filter(Number.isFinite).length, median: median(values), p95: percentile(values) };
}
export function frameStats(times) {
  return { ...summarize(times), dropped: times.filter(time => time > 16.7 + 1e-6).length };
}
// INP-style grouping: several Event Timing entries can describe one interaction.
// interactionId=0 entries (e.g. beforeinput) are not independent interactions.
export function interactionDurations(entries) {
  const groups = new Map();
  for (const entry of entries) if (entry.interactionId) {
    groups.set(entry.interactionId, Math.max(groups.get(entry.interactionId) || 0, entry.duration));
  }
  return [...groups.values()];
}
export function aggregate(runs) {
  const metrics = {};
  for (const run of runs) for (const [name, metric] of Object.entries(run.metrics)) {
    metrics[name] ??= { unit: metric.unit, samples: [] };
    metrics[name].samples.push(...metric.samples);
  }
  return Object.fromEntries(Object.entries(metrics).map(([name, metric]) =>
    [name, { unit: metric.unit, ...summarize(metric.samples) }]));
}
export function profileSelfTime(profile, limit = 15) {
  const nodes = new Map(profile.nodes.map(node => [node.id, node.callFrame]));
  const totals = new Map();
  for (let i = 0; i < (profile.samples || []).length; i++) {
    const frame = nodes.get(profile.samples[i]);
    if (!frame) continue;
    const key = `${frame.functionName}|${frame.url}|${frame.lineNumber}|${frame.columnNumber}`;
    const item = totals.get(key) || {
      name: frame.functionName || '(anonymous)', url: frame.url,
      line: frame.lineNumber + 1, column: frame.columnNumber + 1, selfMs: 0,
    };
    item.selfMs += (profile.timeDeltas?.[i] || 0) / 1000;
    totals.set(key, item);
  }
  const totalMs = [...totals.values()].reduce((sum, item) => sum + item.selfMs, 0);
  return [...totals.values()].sort((a, b) => b.selfMs - a.selfMs).slice(0, limit)
    .map(item => ({ ...item, percent: totalMs ? item.selfMs / totalMs * 100 : 0 }));
}
export function formatTable(summary) {
  return ['| Metric | Unit | Samples | Median | p95 |', '|---|---|---:|---:|---:|',
    ...Object.entries(summary).map(([name, stat]) =>
      `| ${name} | ${stat.unit} | ${stat.count} | ${stat.median?.toFixed(2) ?? 'n/a'} | ${stat.p95?.toFixed(2) ?? 'n/a'} |`)].join('\n');
}
