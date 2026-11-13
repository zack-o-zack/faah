export function fmtBytes(value = 0): string {
  if (value < 1024) return value + ' B';
  if (value < 1048576) return (value / 1024).toFixed(1) + ' KB';
  return (value / 1048576).toFixed(1) + ' MB';
}
export const fmtCpu = (metrics?: { cpuUsage?: number } | null): string =>
  `${(metrics?.cpuUsage || 0).toFixed(1)}%`;
export function imageStatus(document?: StatusDocument | null): string {
  if (!document?.isImage) return '';
  const percent = `${Math.round((document.image?.scale || 1) * 100)}%`;
  const zoom = document.image?.fit ? `Fit (${percent})` : percent;
  return document.imageMeta
    ? `${document.imageMeta.width} × ${document.imageMeta.height} px · ${zoom}`
    : zoom;
}

export function statusMessage(
  workspace: { error?: string; note?: string; reindexing?: boolean; pending?: boolean },
  document?: StatusDocument | null,
): string {
  if (workspace.error) return workspace.error;
  if (workspace.note) return workspace.note;
  if (workspace.reindexing) return 'Re-indexing workspace…';
  if (workspace.pending) return 'Refreshing workspace…';
  return imageStatus(document);
}

export interface StatusDocument {
  isImage?: boolean;
  image?: { fit?: boolean; scale?: number };
  imageMeta?: { width: number; height: number };
}
