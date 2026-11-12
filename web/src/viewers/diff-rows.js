import { changedRanges, syntaxParts } from './diff-intraline.js';

export function pairRows(rows) {
  const pairs = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (row.type === 'ctx') {
      pairs.push({ left: row, right: row });
      i++;
      continue;
    }
    const dels = [];
    const adds = [];
    while (i < rows.length && rows[i].type === 'del') dels.push(rows[i++]);
    while (i < rows.length && rows[i].type === 'add') adds.push(rows[i++]);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++)
      pairs.push({ left: dels[k] || null, right: adds[k] || null });
  }
  return pairs;
}
function parts(row, mask, bars, kind) {
  return row ? { ...row, parts: syntaxParts(row.text || '', row.html, mask, bars, kind) } : null;
}
export function splitRows(rows) {
  return pairRows(rows).map(({ left, right }) => {
    if (left?.type === 'del' && right?.type === 'add') {
      const ranges = changedRanges(left.text, right.text);
      return {
        left: parts(left, ranges.old, ranges.oldBars, 'del'),
        right: parts(right, ranges.next, ranges.newBars, 'add'),
      };
    }
    return { left: parts(left), right: parts(right) };
  });
}
export function unifiedRows(rows) {
  const paired = splitRows(rows);
  const byRow = new Map();
  for (const pair of paired) {
    if (pair.left) byRow.set(pair.left.oldLine, pair.left);
  }
  const right = new Map(
    paired.filter((pair) => pair.right).map((pair) => [pair.right.newLine, pair.right]),
  );
  return rows.map((row) => (row.type === 'del' ? byRow.get(row.oldLine) : right.get(row.newLine)));
}
export function gutterAnchor(row) {
  return row
    ? {
        line: row.newLine,
        at: row.newLine === undefined ? row.at : undefined,
        oldLine: row.oldLine,
      }
    : {};
}
export function diagnosticMap(diagnostics = []) {
  const map = new Map();
  for (const diagnostic of diagnostics) {
    if (diagnostic.line && (!map.has(diagnostic.line) || diagnostic.severity === 1))
      map.set(diagnostic.line, diagnostic);
  }
  return map;
}
export function expandContext(hunk, raw, html = [], step = 15) {
  if (!hunk.rows.length) return hunk;
  const first = hunk.rows[0];
  const firstOld = first.oldLine ?? hunk.oldStart ?? 1;
  const firstNew = first.newLine ?? first.at ?? hunk.newStart ?? 1;
  let lastOld = firstOld;
  let lastNew = firstNew;
  for (const row of hunk.rows) {
    if (row.oldLine !== undefined) lastOld = row.oldLine;
    if (row.newLine !== undefined) lastNew = row.newLine;
  }
  const preCount = Math.min(step, Math.max(0, Math.min(firstOld - 1, firstNew - 1)));
  const rows = [];
  for (let k = preCount; k >= 1; k--)
    rows.push({
      type: 'ctx',
      oldLine: firstOld - k,
      newLine: firstNew - k,
      text: raw[firstNew - k - 1] || '',
      html: html[firstNew - k - 1] || '',
    });
  rows.push(...hunk.rows);
  for (let k = 1; k <= Math.min(step, Math.max(raw.length, html.length) - lastNew); k++)
    rows.push({
      type: 'ctx',
      oldLine: lastOld + k,
      newLine: lastNew + k,
      text: raw[lastNew + k - 1] || '',
      html: html[lastNew + k - 1] || '',
    });
  return { ...hunk, rows, oldStart: firstOld - preCount, newStart: firstNew - preCount };
}
export function commitStepTarget(files, index, direction) {
  for (let next = index + direction; next >= 0 && next < files.length; next += direction)
    if (!files[next].binary) return next;
  return -1;
}
export function rowOffsets(count, heights, estimate = 20) {
  const offsets = new Float64Array(count + 1);
  for (let i = 0; i < count; i++) offsets[i + 1] = offsets[i] + (heights.get(i) || estimate);
  return offsets;
}
export function measuredWindow(offsets, top, height, overscan = 20) {
  const count = offsets.length - 1;
  if (count <= 400) return { start: 0, end: count, before: 0, after: 0 };
  function at(value) {
    let low = 0;
    let high = count;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (offsets[mid + 1] <= value) low = mid + 1;
      else high = mid;
    }
    return low;
  }
  const start = Math.max(0, at(Math.max(0, top)) - overscan);
  const end = Math.min(count, at(Math.max(0, top) + height) + overscan + 1);
  return { start, end, before: offsets[start], after: offsets[count] - offsets[end] };
}

export function gutterSelection(row, path, reviewable = true) {
  if (!row) return null;
  const deleted = row.newLine === undefined;
  const l1 = deleted ? Math.max(1, (row.at || 1) - 1) : row.newLine;
  return {
    path,
    text: row.text || '',
    l1,
    l2: deleted ? Math.max(l1, row.at || 1) : l1,
    delL1: deleted ? row.oldLine : 0,
    delL2: deleted ? row.oldLine : 0,
    fromDiff: true,
    side: deleted ? 'LEFT' : 'RIGHT',
    reviewable,
  };
}
