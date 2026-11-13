import type { DocTab, ImageState } from '../editor/types.ts';
import type { WorkspaceMeta } from '../app/types.ts';
export function previewKind(document: Partial<DocTab> | null | undefined): string {
  if (!document || document.isImage) return '';
  if (/\.(md|markdown)$/i.test(document.path || '') || document.lang === 'Markdown')
    return 'markdown';
  if (/\.(csv|tsv)$/i.test(document.path || '')) return 'table';
  return '';
}

export function viewMode(document: Partial<DocTab> | null | undefined): string {
  if (!document || document.isEditing) return 'source';
  if (document.isImage) return 'image';
  if (document.diffMode) return 'diff';
  return document.view === previewKind(document) ? document.view : 'source';
}

export const isPreview = (document: Partial<DocTab> | null | undefined): boolean =>
  ['markdown', 'table'].includes(viewMode(document));

export function canDiff(
  document: Partial<DocTab> | null | undefined,
  meta: Partial<WorkspaceMeta> | null,
): boolean {
  return !!(
    document &&
    !document.isImage &&
    (document.diffRef ||
      document.diffBase ||
      (meta?.git && (meta.gitFiles?.includes(document.path || '') || document.diffAvailable)))
  );
}

export function blockIndex(lines: number[], line: number): number {
  let best = -1;
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] ?? 0) <= line && (best < 0 || (lines[i] ?? 0) > (lines[best] ?? 0))) best = i;
  }
  return best;
}

export function initialImage(): ImageState {
  return { fit: true, scale: 1, panX: 0, panY: 0, bg: 'checker', pixelated: null };
}
