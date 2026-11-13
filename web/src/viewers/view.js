export function previewKind(document) {
  if (!document || document.isImage) return '';
  if (/\.(md|markdown)$/i.test(document.path) || document.lang === 'Markdown') return 'markdown';
  if (/\.(csv|tsv)$/i.test(document.path)) return 'table';
  return '';
}

export function viewMode(document) {
  if (!document || document.isEditing) return 'source';
  if (document.isImage) return 'image';
  if (document.diffMode) return 'diff';
  return document.view === previewKind(document) ? document.view : 'source';
}

export const isPreview = (document) => ['markdown', 'table'].includes(viewMode(document));

export function canDiff(document, meta) {
  return !!(
    document &&
    !document.isImage &&
    (document.diffRef ||
      document.diffBase ||
      (meta?.git && (meta.gitFiles?.includes(document.path) || document.diffAvailable)))
  );
}

export function blockIndex(lines, line) {
  let best = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] <= line && (best < 0 || lines[i] > lines[best])) best = i;
  }
  return best;
}

export function initialImage() {
  return { fit: true, scale: 1, panX: 0, panY: 0, bg: 'checker', pixelated: null };
}
