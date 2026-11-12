const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@[ \t]?(.*)$/;

// Parses a unified diff (as returned by `git diff`) into hunks, each a flat
// list of rows tagged ctx/add/del carrying old- and/or new-file line numbers.
// File headers (diff --git, index, ---, +++) are skipped: nothing before the
// first @@ is kept.
export function parseDiff(text) {
  if (!text) return [];
  const hunks = [];
  let cur = null,
    oldLine = 0,
    newLine = 0;
  for (const line of text.split('\n')) {
    const m = HUNK_RE.exec(line);
    if (m) {
      oldLine = +m[1];
      newLine = +m[3];
      cur = { oldStart: oldLine, newStart: newLine, section: m[5] || '', rows: [] };
      hunks.push(cur);
      continue;
    }
    if (!cur || line === '' || line.startsWith('\\')) continue; // trailing split artifact, pre-hunk header, or "\ No newline..."
    const c = line[0],
      body = line.slice(1);
    if (c === '+') cur.rows.push({ type: 'add', newLine: newLine++, text: body });
    // A deletion has no line on disk; at is the working-tree line it sat before.
    else if (c === '-') cur.rows.push({ type: 'del', oldLine: oldLine++, at: newLine, text: body });
    else cur.rows.push({ type: 'ctx', oldLine: oldLine++, newLine: newLine++, text: body });
  }
  return hunks;
}

export function serializeHunk(hunk) {
  let oldCount = 0,
    newCount = 0;
  let oldStart = hunk.oldStart || 1;
  let newStart = hunk.newStart || 1;
  let foundOld = false,
    foundNew = false;
  const body = [];
  for (const r of hunk.rows) {
    if (!foundOld && r.oldLine !== undefined) {
      oldStart = r.oldLine;
      foundOld = true;
    }
    if (!foundNew && r.newLine !== undefined) {
      newStart = r.newLine;
      foundNew = true;
    }
    const text = r.text ?? '';
    if (r.type === 'ctx') {
      oldCount++;
      newCount++;
      body.push(' ' + text);
    } else if (r.type === 'del') {
      oldCount++;
      body.push('-' + text);
    } else if (r.type === 'add') {
      newCount++;
      body.push('+' + text);
    }
  }
  return `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n` + body.join('\n') + '\n';
}
