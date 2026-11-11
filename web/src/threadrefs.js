// web/src/threadrefs.js
/* The parts of a thread's rendering that depend on no page state. */

/* Decides what a citation links to. Without refs, anything path-shaped links as
   written. With refs, only targets the server checked link, at the line it
   settled on. Returns null when the citation should stay plain text. */
export function linkTarget(refs, target, path, line, end) {
  if (!refs) return { path, line: line ? +line : 0, end: end ? +end : 0 };
  const r = refs[target];
  if (!r) return null;
  return { path, line: r.line || 0, end: r.end || 0 };
}

const count = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/* One line saying what an explanation rests on. */
export function explainEvidenceLine(ev) {
  if (!ev) return '';
  if (ev.source === 'text') {
    return ev.refs ? 'text match · ' + count(ev.refs, 'occurrence', 'occurrences') + ' in ' + count(ev.refFiles, 'file', 'files') : 'text match';
  }
  const parts = [ev.source];
  if (ev.definition) parts.push('definition');
  if (ev.refs) parts.push(count(ev.refs, 'reference', 'references') + ' in ' + count(ev.refFiles, 'file', 'files'));
  if (ev.callers) parts.push(count(ev.callers, 'caller', 'callers'));
  if (ev.identifiers) parts.push(count(ev.identifiers, 'symbol', 'symbols') + ' resolved');
  return parts.join(' · ');
}

export const explainStaleLabel = reason => ({ reader: 'Written for a different reader', callers: 'Callers changed' })[reason] || 'References changed';
