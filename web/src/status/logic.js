export function fmtBytes(value = 0) {
  if (value < 1024) return value + ' B';
  if (value < 1048576) return (value / 1024).toFixed(1) + ' KB';
  return (value / 1048576).toFixed(1) + ' MB';
}
export const fmtCpu = (metrics) => `${(metrics?.cpuUsage || 0).toFixed(1)}%`;
export function imageStatus(document) {
  if (!document?.isImage) return '';
  const zoom = document.image?.fit ? 'Fit' : `${Math.round((document.image?.scale || 1) * 100)}%`;
  return document.imageMeta
    ? `${document.imageMeta.width} × ${document.imageMeta.height} px · ${zoom}`
    : zoom;
}
