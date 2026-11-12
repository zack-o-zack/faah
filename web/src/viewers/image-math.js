export function fitScale(width, height, viewWidth, viewHeight, padding = 80) {
  if (!width || !height) return 1;
  return Math.max(
    0.05,
    Math.min(1, (viewWidth - padding) / width, (viewHeight - padding) / height),
  );
}
export function zoomScale(scale, direction, factor = 1.25) {
  return Math.max(0.05, Math.min(32, direction > 0 ? scale * factor : scale / factor));
}
export function panFrom(origin, start, current) {
  return { panX: origin.panX + current.x - start.x, panY: origin.panY + current.y - start.y };
}
export function imageTransform(view, fitted) {
  return `translate(${view.panX}px, ${view.panY}px) scale(${view.fit ? fitted : view.scale})`;
}
